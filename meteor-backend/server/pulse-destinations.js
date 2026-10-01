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
 *   ticket | clock     → an attachment on that ticket / clock session
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
import { appendWrapUp, createHuddlePost, getTeam, isTeamMember, POST_DATE_RE } from './huddle.js';
import { requireTeamMembership } from './permissions.js';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

// clock.js reaches pulsevault.js through timesheet-change-requests.js, so a
// static import here would close a cycle; load it when a clock upload lands.
const clockModule = () => import('./clock.js');

function badRequest(message) {
  return new Meteor.Error('bad-request', message);
}

/** What a failure says to the uploader: its reason when it has one. */
function reasonOf(err) {
  return err instanceof Meteor.Error ? err.reason : 'Something went wrong adding it there.';
}

async function assertTeamMember(userId, teamId) {
  if (typeof teamId !== 'string' || !teamId) throw badRequest('Invalid teamId');
  const team = await getTeam(teamId);
  if (!team) throw new Meteor.Error('not-found', 'Team not found');
  if (!isTeamMember(team, userId)) throw new Meteor.Error('forbidden', 'Not a member of this team');
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
 * second. `recordedFor` is the destination a kept video never reached.
 */
async function addToLibrary(userId, video, recordedFor = null) {
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
        ...(recordedFor ? { $set: { recordedFor } } : {}),
      },
      { upsert: true, returnDocument: 'after', projection: { _id: 1 } },
    );
  return item._id.toHexString();
}

/** A new Huddle post carrying the video, with the Pulse draft's name as its text. */
async function postVideo(userId, video, { teamId, postDate }) {
  const mediaId = await addToLibrary(userId, video);
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
 * a note for the popup instead of keeping the video.
 */
async function followUp(failure, step) {
  try {
    await step();
    return undefined;
  } catch (err) {
    console.warn('[pulse-destinations] delivered, but the follow-up failed:', err);
    return `${failure}: ${reasonOf(err).replace(/\.$/, '')}.`;
  }
}

/**
 * Clock in with the plan that was just posted. Clocked in some other way
 * meanwhile: no second session, but the plan still becomes that session's.
 */
async function clockInWithPlan(userId, teamId, planPostId) {
  const open = await rawDb()
    .collection('clockevents')
    .findOne({ userId, teamId, endTime: null }, { projection: { _id: 1 } });
  if (open) {
    // Not `updatedAt` — linking a session isn't an edit (see clockStart).
    await rawDb()
      .collection('huddlePosts')
      .updateOne({ _id: new ObjectId(planPostId) }, { $set: { clockEventId: open._id.toHexString() } });
    return;
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
      await assertTeamMember(userId, teamId);
      return { teamId };
    },
    async deliver(userId, { teamId }, video) {
      await postVideo(userId, video, { teamId });
    },
  },

  'clock-plan': {
    async resolve(userId, { teamId, postDate }) {
      await assertTeamMember(userId, teamId);
      assertPostDate(postDate);
      return { teamId, postDate };
    },
    async deliver(userId, { teamId, postDate }, video) {
      const { id: planPostId } = await postVideo(userId, video, { teamId, postDate });
      return followUp("Plan posted, but you weren't clocked in", () =>
        clockInWithPlan(userId, teamId, planPostId),
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
      await assertTeamMember(userId, String(session.teamId));
      assertPostDate(postDate);
      return { clockEventId, postDate };
    },
    async deliver(userId, { clockEventId, postDate }, video) {
      const session = await ownSession(userId, clockEventId);
      const teamId = String(session.teamId);
      const mediaId = await addToLibrary(userId, video);
      await appendWrapUp(userId, {
        teamId,
        clockEventId,
        postDate,
        line: video.name ? `**Wrap-up:** ${video.name}` : '**Wrap-up**',
        attachment: postAttachment(mediaId, video),
      });
      if (session.endTime != null) return undefined;
      return followUp("Wrap-up posted, but you weren't clocked out", async () => {
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
      // Only while still pending: a walkthrough can't change a decided request.
      const { matchedCount } = await rawDb()
        .collection('timesheetchangerequests')
        .updateOne({ _id: new ObjectId(id), userId, status: 'pending' }, { $set: { videoUrl: video.url } });
      if (!matchedCount) throw badRequest('That change has already been reviewed.');
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
  const kind = DESTINATIONS[destination?.kind];
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
  await addToLibrary(userId, video, destination);
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
