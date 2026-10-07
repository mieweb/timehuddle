/**
 * Pulse destinations — where a Pulse upload lands, decided when its link is
 * minted and carried out by the server the moment the video arrives.
 *
 * One link, one upload, one destination. `pulsevault.reserve` signs the
 * destination into the capability token's `context`; PulseVault stores it
 * with the upload and hands it back to `onUploadComplete`, which delivers
 * here. Nothing is recorded in between — there is no reservation table.
 *
 *   library  → the uploader's media library
 *   ticket   → an attachment on a Huddle ticket
 *   redmine  → an attachment on a Redmine issue (lives only in TimeHuddle)
 *   clock    → an attachment on the uploader's own clock session
 *   huddle   → a new Huddle post in that team, with the Pulse draft's name as its text
 *   clock-plan   → a new plan post in that team, then clock in to it
 *   clock-wrapup → the video and a wrap-up line on the session's post, then clock out
 *   timesheet-request → the walkthrough on the uploader's own pending timesheet change
 *
 * Each kind is one entry in DESTINATIONS. `check` runs when the link is
 * minted, so a bad destination fails before anyone records anything, and
 * again at delivery, since anything may have changed while the video was
 * recorded. `deliver` is idempotent on the video id: PulseVault fires a
 * completion again if the first one threw or the server restarted before it
 * was recorded.
 */
import { Meteor } from 'meteor/meteor';
import { MongoInternals } from 'meteor/mongo';

import { createAttachment } from './attachments.js';
import { isObjectIdHex, rawDb } from './collections.js';
import { appendWrapUp, createHuddlePost, POST_DATE_RE, requireTeamMember } from './huddle.js';
import { requireTeamMembership } from './permissions.js';
import { REDMINE, resolveTicketRef } from './ticket-refs.js';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

// clock.js reaches pulsevault.js through timesheet-change-requests.js, so a
// static import here would close a cycle; load it when a clock video lands.
const clockModule = () => import('./clock.js');

const LIBRARY_NOTE = 'Added to the media library';

function requireId(id, what) {
  if (typeof id !== 'string' || !id) throw new Meteor.Error('bad-request', `Invalid ${what} id`);
}

/** The attachment this video already is on a ticket or Redmine issue, if any. */
function existingAttachment(attachedTo, video) {
  return rawDb()
    .collection('attachments')
    .findOne(
      { url: video.url, 'attachedTo.kind': attachedTo.kind, 'attachedTo.id': attachedTo.id },
      { projection: { _id: 1 } },
    );
}

const attachedNote = (kind, id) => `Attached to ${kind} ${id}`;

/** A ticket-like destination: the video becomes an attachment on `{ kind, id }`. */
const attachment = (kind, check) => ({
  check,
  async delivered(_userId, { id }, video) {
    return (await existingAttachment({ kind, id }, video)) ? attachedNote(kind, id) : null;
  },
  async deliver(userId, { id }, video) {
    await createAttachment({
      url: video.url,
      type: 'video',
      title: video.title,
      attachedTo: { kind, id },
      addedBy: userId,
    });
    return attachedNote(kind, id);
  },
});

/**
 * Every destination kind. `check(userId, destination)` throws a Meteor.Error
 * when the video may not go there (and returns the fields to sign into the
 * token); `delivered(userId, destination, video)` is the note from an earlier
 * delivery of this video, or null; `deliver(userId, destination, video)`
 * carries it out and returns the note.
 */
/** The video's media-library item, created once; returns its id. */
async function addToLibrary(userId, video) {
  const media = rawDb().collection('mediaitems');
  const existing = await media.findOne({ videoid: video.artifactId }, { projection: { _id: 1 } });
  if (existing) return existing._id.toHexString();
  const _id = new ObjectId();
  await media.insertOne({
    _id,
    userId,
    type: 'video',
    mimeType: video.mimeType,
    url: video.url,
    videoid: video.artifactId,
    filename: video.filename,
    size: video.size,
    title: video.title,
    caption: null,
    altText: null,
    thumbnail: null,
    uploadedAt: new Date(),
  });
  return _id.toHexString();
}

const HUDDLE_NOTE = 'Posted to Huddle';
// The frontend's landed labels for these two kinds are these exact words
// (pulseStatus.ts): a note that says more is a follow-up that failed.
const PLAN_NOTE = "Plan posted — you're clocked in";
const WRAPUP_NOTE = "Wrap-up posted — you're clocked out";
const WALKTHROUGH_NOTE = 'Walkthrough added to the change request';

function assertPostDate(postDate) {
  // The poster's calendar date, from their device — the server can't know
  // their time zone, and the plan-first gate is per date.
  if (!POST_DATE_RE.test(postDate ?? '')) throw new Meteor.Error('bad-request', 'Invalid postDate');
}

/** The uploader's own clock session, by id. */
async function ownSession(userId, rawId) {
  requireId(rawId, 'clock session');
  if (!isObjectIdHex(rawId)) throw new Meteor.Error('not-found', 'Clock session not found');
  const session = await rawDb()
    .collection('clockevents')
    .findOne({ _id: new ObjectId(rawId.toLowerCase()) }, { projection: { userId: 1, teamId: 1, endTime: 1 } });
  if (!session) throw new Meteor.Error('not-found', 'Clock session not found');
  if (session.userId !== userId) throw new Meteor.Error('forbidden', 'Not your clock session');
  return session;
}

/** The attachment shape a Huddle post stores for a Pulse video. */
function postAttachment(mediaId, video) {
  return { mediaId, type: 'video', url: video.url, filename: video.title };
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

/** This uploader's post in this team carrying the video, if any. */
function existingPost(userId, teamId, video) {
  return rawDb()
    .collection('huddlePosts')
    .findOne({ teamId, userId, 'attachments.url': video.url }, { projection: { _id: 1, clockEventId: 1 } });
}

/** The session's post carrying the video as its wrap-up, if any. */
function existingWrapUp(userId, clockEventId, video) {
  return rawDb()
    .collection('huddlePosts')
    .findOne({ userId, clockEventId, 'attachments.url': video.url }, { projection: { _id: 1 } });
}

/**
 * A step after a delivery that already happened (clocking in once the plan is
 * posted). Its failure can't un-deliver the video, so it comes back in the
 * note: what did happen, then what didn't and why, or what to do instead.
 */
async function withFollowUp(note, failure, instead, step) {
  try {
    await step();
    return note;
  } catch (err) {
    console.warn('[pulse-destinations] delivered, but the follow-up failed:', err);
    const why = err instanceof Meteor.Error && err.reason ? `: ${err.reason.replace(/\.$/, '')}.` : `. ${instead}`;
    return `${note.split(' — ')[0]}, but ${failure}${why}`;
  }
}

/**
 * Clock in to this team with the plan that was just posted, as clocking in by
 * hand would: only this team's clock matters. Clocked in to this team some
 * other way meanwhile: no second session, but the plan becomes that
 * session's (clockStart decides that next to its insert). Clocked in and back
 * out of this team by hand since the link was made: that shift is over, so it
 * isn't restarted.
 */
async function clockInWithPlan(userId, teamId, planPostId, reservedAt) {
  const sessions = rawDb().collection('clockevents');
  const open = await sessions.findOne({ userId, teamId, endTime: null }, { projection: { _id: 1 } });
  if (!open && reservedAt && (await sessions.findOne({ userId, teamId, startTime: { $gte: reservedAt } }))) {
    throw new Meteor.Error('already-clocked-out', 'You clocked in and out while it uploaded');
  }
  const { clockStart } = await clockModule();
  await clockStart(userId, { teamId, planPostId, reuseOpen: true });
}

const DESTINATIONS = {
  library: {
    async check() {
      return {};
    },
    async delivered(_userId, _destination, video) {
      const item = await rawDb()
        .collection('mediaitems')
        .findOne({ videoid: video.artifactId }, { projection: { _id: 1 } });
      return item ? LIBRARY_NOTE : null;
    },
    async deliver(userId, _destination, video) {
      await addToLibrary(userId, video);
      return LIBRARY_NOTE;
    },
  },

  huddle: {
    async check(userId, { teamId }) {
      requireId(teamId, 'team');
      await requireTeamMember(userId, teamId);
      return { teamId };
    },
    // This uploader's post in this team: a post elsewhere carrying the same
    // video (huddle.createPost takes attachment URLs) isn't this delivery.
    async delivered(userId, { teamId }, video) {
      const post = await rawDb()
        .collection('huddlePosts')
        .findOne({ teamId, userId, 'attachments.url': video.url }, { projection: { _id: 1 } });
      return post ? HUDDLE_NOTE : null;
    },
    async deliver(userId, { teamId }, video) {
      const mediaId = await addToLibrary(userId, video);
      await createHuddlePost(userId, {
        teamId,
        content: { text: video.name ?? '', mentions: [] },
        attachments: [{ mediaId, type: 'video', url: video.url, filename: video.title }],
      });
      return HUDDLE_NOTE;
    },
  },

  'clock-plan': {
    async check(userId, { teamId, postDate }) {
      requireId(teamId, 'team');
      await requireTeamMember(userId, teamId);
      assertPostDate(postDate);
      // When the link was made, so delivery can tell a shift worked by hand
      // meanwhile. Signed into the token at reserve; unused at delivery.
      return { teamId, postDate, reservedAt: Date.now() };
    },
    // Two steps, so "delivered" is both: the post, and the session it was
    // linked to by the clock-in. A post with no session is a delivery that
    // stopped halfway (the process died between the two), and runs again.
    async delivered(userId, { teamId }, video) {
      const post = await existingPost(userId, teamId, video);
      return post?.clockEventId ? PLAN_NOTE : null;
    },
    async deliver(userId, { teamId, postDate, reservedAt }, video) {
      // The post from a delivery that stopped before the clock-in, if any; never a second one.
      const existing = await existingPost(userId, teamId, video);
      const planPostId = existing
        ? existing._id.toHexString()
        : (await postVideo(userId, video, { teamId, postDate })).id;
      return withFollowUp(PLAN_NOTE, "you weren't clocked in", 'Clock in from the Clock page.', () =>
        clockInWithPlan(userId, teamId, planPostId, reservedAt),
      );
    },
  },

  'clock-wrapup': {
    async check(userId, { clockEventId, postDate }, phase) {
      const session = await ownSession(userId, clockEventId);
      // Ending the session some other way while recording is fine: the
      // wrap-up still lands on its post.
      if (phase === 'reserve' && session.endTime != null) {
        throw new Meteor.Error('bad-request', 'That clock session has already ended');
      }
      await requireTeamMember(userId, String(session.teamId));
      assertPostDate(postDate);
      return { clockEventId: clockEventId.toLowerCase(), postDate };
    },
    // Two steps here too: the wrap-up on the post, and the session ended. A
    // wrap-up on a session still open stopped halfway, and runs again.
    async delivered(userId, { clockEventId }, video) {
      if (!(await existingWrapUp(userId, clockEventId, video))) return null;
      const session = await rawDb()
        .collection('clockevents')
        .findOne({ _id: new ObjectId(clockEventId) }, { projection: { endTime: 1 } });
      return session?.endTime != null ? WRAPUP_NOTE : null;
    },
    async deliver(userId, { clockEventId, postDate }, video) {
      const session = await ownSession(userId, clockEventId);
      const teamId = String(session.teamId);
      // Not appended twice when a delivery stopped before the clock-out.
      if (!(await existingWrapUp(userId, clockEventId, video))) {
        const mediaId = await addToLibrary(userId, video);
        await appendWrapUp(userId, {
          teamId,
          clockEventId,
          postDate,
          line: video.name ? `**Wrap-up:** ${video.name}` : '**Wrap-up**',
          attachment: postAttachment(mediaId, video),
        });
      }
      // Read again after the write: the session may have been ended by hand
      // while the wrap-up was appended. A newer shift in this team isn't this
      // wrap-up's to end, and clockStop below is told which session it may stop.
      if ((await ownSession(userId, clockEventId)).endTime != null) {
        const open = await rawDb()
          .collection('clockevents')
          .findOne({ userId, teamId, endTime: null }, { projection: { _id: 1 } });
        return open
          ? "Wrap-up posted to your earlier session, and you're still clocked in to your current one"
          : 'Wrap-up posted to your earlier session';
      }
      return withFollowUp(WRAPUP_NOTE, "you weren't clocked out", 'Clock out from the Clock page.', async () => {
        const { clockStop } = await clockModule();
        await clockStop(userId, { teamId, clockEventId });
      });
    },
  },

  'timesheet-request': {
    async check(userId, { id: rawId }) {
      requireId(rawId, 'change request');
      if (!isObjectIdHex(rawId)) throw new Meteor.Error('not-found', 'Change request not found');
      const id = rawId.toLowerCase();
      const request = await rawDb()
        .collection('timesheetchangerequests')
        .findOne({ _id: new ObjectId(id) }, { projection: { userId: 1, status: 1, videoUrl: 1 } });
      if (!request) throw new Meteor.Error('not-found', 'Change request not found');
      if (request.userId !== userId) throw new Meteor.Error('forbidden', 'Not your change request');
      // Refusals as not-found, so a video that arrives too late is kept, not replayed.
      if (request.status !== 'pending') {
        throw new Meteor.Error('not-found', 'That change is no longer waiting for approval');
      }
      if (request.videoUrl) throw new Meteor.Error('not-found', 'That change already has a walkthrough');
      return { id };
    },
    async delivered(userId, { id }, video) {
      const request = await rawDb()
        .collection('timesheetchangerequests')
        .findOne({ _id: new ObjectId(id), userId, videoUrl: video.url }, { projection: { _id: 1 } });
      return request ? WALKTHROUGH_NOTE : null;
    },
    async deliver(userId, { id }, video) {
      // Still pending and still without one: a walkthrough never replaces another.
      const { matchedCount } = await rawDb()
        .collection('timesheetchangerequests')
        .updateOne(
          { _id: new ObjectId(id), userId, status: 'pending', videoUrl: { $in: [null, ''] } },
          { $set: { videoUrl: video.url } },
        );
      if (!matchedCount) throw new Error('The change request moved on while the walkthrough landed');
      // Approval views reload when these prompts change, so an open request shows it.
      await rawDb()
        .collection('notifications')
        .updateMany(
          { 'data.type': 'timesheet-change-request', 'data.requestId': id },
          { $set: { 'data.hasWalkthrough': true } },
        );
      return WALKTHROUGH_NOTE;
    },
  },

  ticket: attachment('ticket', async (userId, { id: rawId }) => {
    requireId(rawId, 'ticket');
    // `isValidId` also takes legacy Meteor ids, which `new ObjectId` throws on.
    if (!isObjectIdHex(rawId)) throw new Meteor.Error('not-found', 'Ticket not found');
    // As `toHexString` writes it, which is how attachments are found again.
    const id = rawId.toLowerCase();
    // `tickets.delete` soft-deletes, so a deleted ticket still has a document.
    const ticket = await rawDb()
      .collection('tickets')
      .findOne({ _id: new ObjectId(id), status: { $ne: 'deleted' } }, { projection: { teamId: 1 } });
    if (!ticket) throw new Meteor.Error('not-found', 'Ticket not found');
    // Whoever can see the ticket's team — the same check as reading the ticket,
    // unconditional like there: a ticket without a valid team is refused.
    await requireTeamMembership(userId, String(ticket.teamId ?? ''));
    return { id };
  }),

  // An issue the uploader's own Redmine key can see (attachments.add's own check).
  [REDMINE]: attachment(REDMINE, async (userId, { id }) => {
    requireId(id, 'Redmine issue');
    await resolveTicketRef(userId, REDMINE, id);
    return { id };
  }),

  clock: attachment('clock', async (userId, { id: rawId }) => {
    requireId(rawId, 'clock session');
    if (!isObjectIdHex(rawId)) throw new Meteor.Error('not-found', 'Clock session not found');
    const id = rawId.toLowerCase();
    const session = await rawDb()
      .collection('clockevents')
      .findOne({ _id: new ObjectId(id) }, { projection: { userId: 1 } });
    if (!session) throw new Meteor.Error('not-found', 'Clock session not found');
    if (session.userId !== userId) throw new Meteor.Error('forbidden', 'Not your clock session');
    return { id };
  }),
};

/** Every destination kind, for the reserve method's schema. */
export const PULSE_DESTINATION_KINDS = Object.keys(DESTINATIONS);

/** The entry for a destination's kind, or null. Own keys only: `constructor` and friends aren't kinds. */
function kindOf(destination) {
  return Object.hasOwn(DESTINATIONS, destination?.kind ?? '') ? DESTINATIONS[destination.kind] : null;
}

/**
 * Check that `destination` is somewhere `userId` may send a Pulse video, and
 * return the form to sign into the token. Throws a Meteor.Error if not.
 * `check(userId, destination, phase)` runs with `phase` 'reserve' here and
 * 'deliver' from deliverPulseVideo, for a kind that is stricter up front.
 */
export async function resolvePulseDestination(userId, destination) {
  const kind = kindOf(destination);
  if (!kind) throw new Meteor.Error('bad-request', 'Unknown Pulse destination');
  return { kind: destination.kind, ...(await kind.check(userId, destination, 'reserve')) };
}

/**
 * Deliver a finished video to the destination its token carried, and say how
 * it went: `{ state: 'done', note }`, or `{ state: 'kept', reason }` when the
 * destination is gone for good (the ticket was deleted, the uploader left its
 * team) — the video stays in storage, and the status route says why. Anything
 * else (Redmine unreachable, a write failed) is thrown, so PulseVault replays
 * the completion later.
 *
 * A replay of a delivery that did happen, but whose outcome never got
 * recorded, gets the same `done` as the first time — whatever has become of
 * the destination since — so the check runs only for a video not yet there.
 *
 * `video` is `{ artifactId, url, name, title, filename, mimeType, size }`:
 * `name` is the Pulse draft's title when one was sent.
 */
export async function deliverPulseVideo(userId, destination, video) {
  const kind = kindOf(destination);
  // Only a token this server signed gets here, so this is a kind that has since been removed.
  if (!kind) return { state: 'kept', reason: `Unknown Pulse destination "${destination?.kind}"` };
  const earlier = await kind.delivered(userId, destination, video);
  if (earlier) return { state: 'done', note: earlier };
  try {
    await kind.check(userId, destination, 'deliver');
  } catch (err) {
    if (err instanceof Meteor.Error && (err.error === 'not-found' || err.error === 'forbidden')) {
      return { state: 'kept', reason: `${err.reason} — it was gone before the video finished uploading.` };
    }
    throw err;
  }
  return { state: 'done', note: await kind.deliver(userId, destination, video) };
}
