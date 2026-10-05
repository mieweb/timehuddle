/**
 * Pulse destinations — where a Pulse upload ends up, decided when it's
 * reserved and carried out by the server the moment it lands.
 *
 * Pulse is built as "one link, one upload": each pairing link names one video
 * id and one place it goes. The web app never has to collect the finished
 * video and do something with it — the upload *is* the post, the attachment,
 * the walkthrough. Every place that offers Pulse picks one of these:
 *
 *   huddle             → a new Huddle post in that team
 *   clock-plan         → a new plan post, then clock in to that team
 *   clock-wrapup       → the session's post gets the video as its wrap-up,
 *                        then clock out
 *   ticket | redmine | clock
 *                      → an attachment on that ticket / Redmine issue / clock
 *                        session
 *   timesheet-request  → the walkthrough on the caller's pending change request
 *   library            → the caller's media library (API clients)
 *
 * Each kind is one entry in DESTINATIONS: `resolve` checks the destination
 * and returns its stored form, and `deliver` carries it out. `resolve` runs
 * twice — when the upload is reserved (so a bad destination fails before
 * anyone records anything) and again just before delivery, since anything
 * may have changed while the video was recorded.
 *
 * A video is never thrown away. If its destination stopped being valid (the
 * session was deleted, the change was reviewed, the uploader left the team),
 * it's kept in the uploader's media library with the destination it was
 * recorded for, and the reason goes back to the Pulse popup.
 */
import { Meteor } from 'meteor/meteor';
import { MongoInternals } from 'meteor/mongo';

import { createAttachment } from './attachments.js';
import { isValidId, rawDb } from './collections.js';
import { appendWrapUp, createHuddlePost, POST_DATE_RE, requireTeamMember } from './huddle.js';
import { requireTeamMembership } from './permissions.js';
import { REDMINE, resolveTicketRef } from './ticket-refs.js';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

// clock.js reaches pulsevault.js through timesheet-change-requests.js, so a
// static import here would close a cycle; load it when a clock upload lands.
const clockModule = () => import('./clock.js');

function badRequest(message) {
  return new Meteor.Error('bad-request', message);
}

/** What a failure says to the uploader: its reason when it has one. */
function reasonOf(err) {
  return (err instanceof Meteor.Error && err.reason) || 'Something went wrong adding it there.';
}

function assertPostDate(postDate) {
  // The poster's calendar date, from their device — the server can't know
  // their time zone, and the plan-first gate is per date.
  if (!POST_DATE_RE.test(postDate ?? '')) throw badRequest('Invalid postDate');
}

async function ownSession(userId, clockEventId) {
  if (!isValidId(clockEventId)) throw badRequest('Invalid clockEventId');
  const session = await rawDb()
    .collection('clockevents')
    .findOne({ _id: new ObjectId(clockEventId) }, { projection: { userId: 1, teamId: 1, endTime: 1 } });
  if (!session) throw new Meteor.Error('not-found', 'That clock session no longer exists.');
  if (session.userId !== userId) throw new Meteor.Error('forbidden', 'Not your clock session');
  return session;
}

/**
 * Record the upload in the uploader's media library; returns its id. One item
 * per video, so keeping a video after a half-finished delivery can't add a
 * second. `teamId` is the team it was posted to — the only teammates who may
 * list it (media.listForUser); without one it stays private to the uploader.
 * `recordedFor` is the destination a kept video never reached: keeping it
 * clears any `teamId` a half-done delivery wrote, since it was never posted.
 */
async function addToLibrary(userId, video, { teamId, recordedFor } = {}) {
  const item = await rawDb()
    .collection('mediaitems')
    .findOneAndUpdate(
      { userId, videoid: video.artifactId },
      {
        $setOnInsert: {
          type: 'video',
          mimeType: video.mimeType,
          url: video.url,
          filename: video.filename,
          size: video.size,
          title: video.title,
          caption: null,
          altText: null,
          thumbnail: null,
          uploadedAt: new Date(),
        },
        ...(recordedFor
          ? { $set: { recordedFor }, $unset: { teamId: '' } }
          : teamId
            ? { $set: { teamId } }
            : {}),
      },
      { upsert: true, returnDocument: 'after', projection: { _id: 1 } },
    );
  return item._id.toHexString();
}

/** A new Huddle post carrying the video, with the Pulse draft's name as its text. */
async function postVideo(userId, video, { teamId, postDate }) {
  const mediaId = await addToLibrary(userId, video, { teamId });
  return createHuddlePost(userId, {
    teamId,
    content: { text: video.name ?? '', mentions: [] },
    attachments: [postAttachment(mediaId, video)],
    ...(postDate ? { postDate } : {}),
  });
}

/** The attachment shape a Huddle post stores for a Pulse video. */
function postAttachment(mediaId, video) {
  return { mediaId, type: 'video', url: video.url, filename: video.title };
}

async function attachVideo(userId, destination, video) {
  await createAttachment({
    url: video.url,
    type: 'video',
    title: video.title,
    attachedTo: { kind: destination.kind, id: destination.id },
    addedBy: userId,
  });
}

/**
 * A step that follows a delivery that already happened (clocking in after the
 * plan is posted). Its failure can't un-deliver the video, so it comes back as
 * a note for the popup instead of keeping the video: what didn't happen, then
 * why — or, when there's no reason to give, what to do instead.
 */
async function followUp(failure, instead, step) {
  try {
    await step();
    return undefined;
  } catch (err) {
    console.warn('[pulse-destinations] delivered, but the follow-up failed:', err);
    return err instanceof Meteor.Error && err.reason
      ? `${failure}: ${err.reason.replace(/\.$/, '')}.`
      : `${failure}. ${instead}`;
  }
}

/**
 * Clock in to this team with the plan that was just posted, the same as
 * clocking in by hand: only this team's clock matters (how clocks work across
 * teams is #642). Clocked in to this team some other way meanwhile: no second
 * session, but the plan still becomes that session's. Clocked in and back out
 * of this team by hand since the link was made: that shift is over, so it
 * isn't restarted.
 */
async function clockInWithPlan(userId, teamId, planPostId, reservedAt) {
  const sessions = rawDb().collection('clockevents');
  const open = await sessions.findOne({ userId, teamId, endTime: null }, { projection: { _id: 1 } });
  if (open) {
    // Not `updatedAt` — linking a session isn't an edit (see clockStart).
    await rawDb()
      .collection('huddlePosts')
      .updateOne({ _id: new ObjectId(planPostId) }, { $set: { clockEventId: open._id.toHexString() } });
    return;
  }
  // `reservedAt` is missing on links made before it was recorded.
  if (reservedAt && (await sessions.findOne({ userId, teamId, startTime: { $gte: reservedAt } }))) {
    throw new Meteor.Error('already-clocked-out', 'You clocked in and out while it uploaded.');
  }
  const { clockStart } = await clockModule();
  await clockStart(userId, { teamId, planPostId });
}

/**
 * Every destination kind. `resolve(userId, destination, phase)` checks it —
 * `phase` is 'reserve' or 'deliver' — and returns the fields to store;
 * `deliver(userId, destination, video)` carries it out and may return a note
 * for the uploader.
 */
const DESTINATIONS = {
  huddle: {
    async resolve(userId, { teamId }) {
      await requireTeamMember(userId, teamId);
      return { teamId };
    },
    async deliver(userId, { teamId }, video) {
      await postVideo(userId, video, { teamId });
    },
  },

  'clock-plan': {
    async resolve(userId, { teamId, postDate }) {
      await requireTeamMember(userId, teamId);
      assertPostDate(postDate);
      // When the link was made, so delivery can tell a shift worked by hand
      // meanwhile (stored at reserve; the deliver-phase result is unused).
      return { teamId, postDate, reservedAt: Date.now() };
    },
    async deliver(userId, { teamId, postDate, reservedAt }, video) {
      const { id: planPostId } = await postVideo(userId, video, { teamId, postDate });
      return followUp("Plan posted, but you weren't clocked in", 'Clock in from the Clock page.', () =>
        clockInWithPlan(userId, teamId, planPostId, reservedAt),
      );
    },
  },

  'clock-wrapup': {
    async resolve(userId, { clockEventId, postDate }, phase) {
      const session = await ownSession(userId, clockEventId);
      // Ending the session some other way while recording is fine: the
      // wrap-up still lands on its post.
      if (phase === 'reserve' && session.endTime != null) {
        throw badRequest('That clock session has already ended');
      }
      await requireTeamMember(userId, String(session.teamId));
      assertPostDate(postDate);
      return { clockEventId, postDate };
    },
    async deliver(userId, { clockEventId, postDate }, video) {
      const session = await ownSession(userId, clockEventId);
      const teamId = String(session.teamId);
      const mediaId = await addToLibrary(userId, video, { teamId });
      await appendWrapUp(userId, {
        teamId,
        clockEventId,
        postDate,
        line: video.name ? `**Wrap-up:** ${video.name}` : '**Wrap-up**',
        attachment: postAttachment(mediaId, video),
      });
      if (session.endTime != null) {
        // Ended by hand meanwhile. A newer shift in this team isn't this wrap-up's to end.
        const open = await rawDb()
          .collection('clockevents')
          .findOne({ userId, teamId, endTime: null }, { projection: { _id: 1 } });
        return open ? "Wrap-up posted to your earlier session. You're still clocked in to your current one." : undefined;
      }
      return followUp("Wrap-up posted, but you weren't clocked out", 'Clock out from the Clock page.', async () => {
        const { clockStop } = await clockModule();
        await clockStop(userId, { teamId });
      });
    },
  },

  ticket: {
    async resolve(userId, { id }) {
      if (!isValidId(id)) throw badRequest('Invalid ticket id');
      const ticket = await rawDb()
        .collection('tickets')
        .findOne({ _id: new ObjectId(id), status: { $ne: 'deleted' } }, { projection: { teamId: 1 } });
      if (!ticket) throw new Meteor.Error('not-found', 'That ticket no longer exists.');
      // Whoever can see the team's tickets (tickets.list's own check).
      await requireTeamMembership(userId, String(ticket.teamId));
      return { id };
    },
    deliver: attachVideo,
  },

  // A Redmine issue's attachments live only in TimeHuddle, on an issue the
  // uploader's own Redmine key can see (attachments.add's own check).
  [REDMINE]: {
    async resolve(userId, { id }) {
      if (typeof id !== 'string' || !id) throw badRequest('Invalid Redmine issue id');
      await resolveTicketRef(userId, REDMINE, id);
      return { id };
    },
    deliver: attachVideo,
  },

  clock: {
    async resolve(userId, { id }) {
      await ownSession(userId, id);
      return { id };
    },
    deliver: attachVideo,
  },

  'timesheet-request': {
    async resolve(userId, { id }) {
      if (!isValidId(id)) throw badRequest('Invalid request id');
      const request = await rawDb()
        .collection('timesheetchangerequests')
        .findOne({ _id: new ObjectId(id) }, { projection: { userId: 1, status: 1 } });
      if (!request) throw new Meteor.Error('not-found', 'Change request not found');
      if (request.userId !== userId) throw new Meteor.Error('forbidden', 'Not your change request');
      if (request.status !== 'pending') throw badRequest('That change has already been reviewed.');
      return { id };
    },
    async deliver(userId, { id }, video) {
      // Only while still pending (a walkthrough can't change a decided
      // request), and only the first: a second never replaces it — the
      // video that lost the race is kept in the library instead.
      const requests = rawDb().collection('timesheetchangerequests');
      const { matchedCount } = await requests.updateOne(
        { _id: new ObjectId(id), userId, status: 'pending', videoUrl: { $in: [null, ''] } },
        { $set: { videoUrl: video.url } },
      );
      if (matchedCount) return;
      const request = await requests.findOne({ _id: new ObjectId(id) }, { projection: { status: 1 } });
      throw badRequest(
        request?.status === 'pending'
          ? 'That change already has a walkthrough.'
          : 'That change has already been reviewed.',
      );
    },
  },

  library: {
    async resolve() {
      return {};
    },
    async deliver(userId, _destination, video) {
      await addToLibrary(userId, video);
    },
  },
};

/** Every destination kind, for the reserve method's schema. */
export const PULSE_DESTINATION_KINDS = Object.keys(DESTINATIONS);

function kindOf(destination) {
  // Own keys only: `constructor` and friends aren't destinations.
  const kind = Object.hasOwn(DESTINATIONS, destination?.kind ?? '') ? DESTINATIONS[destination.kind] : null;
  if (!kind) throw badRequest('Unknown Pulse destination');
  return kind;
}

/**
 * Check `destination` is somewhere `userId` may send a Pulse video, and return
 * the normalized form stored with the upload. Throws a Meteor.Error if not.
 */
export async function resolvePulseDestination(userId, destination) {
  const fields = await kindOf(destination).resolve(userId, destination, 'reserve');
  return { kind: destination.kind, ...fields };
}

/**
 * Keep a video in the uploader's library because it can't go where it was
 * recorded for — never thrown away. Returns the outcome to report.
 */
export async function keepPulseVideo(userId, destination, video, reason) {
  await addToLibrary(userId, video, { recordedFor: destination });
  return { kept: true, reason };
}

/**
 * Carry out an upload's destination for a finished Pulse video, keeping it in
 * the uploader's library if that's no longer possible.
 *
 * `video` is `{ artifactId, url, name, title, filename, mimeType, size }`:
 * `name` is the Pulse draft's title (Upload-Metadata `name`) or null, `title`
 * the display title (the name, or a short fallback).
 *
 * Returns `{ kept: false, note? }` once delivered — `note` when a step after
 * delivery failed — or `{ kept: true, reason }` when the video went to the
 * library instead. Throws only when even the library can't take it.
 */
export async function deliverPulseVideo(userId, destination, video) {
  try {
    const kind = kindOf(destination);
    await kind.resolve(userId, destination, 'deliver');
    const note = await kind.deliver(userId, destination, video);
    return note ? { kept: false, note } : { kept: false };
  } catch (err) {
    if (destination?.kind === 'library') throw err;
    console.warn('[pulse-destinations] kept in library, not delivered to', destination?.kind, err);
    return keepPulseVideo(userId, destination, video, reasonOf(err));
  }
}
