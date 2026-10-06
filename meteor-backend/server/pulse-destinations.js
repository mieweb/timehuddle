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
import { isValidId, rawDb } from './collections.js';
import { createHuddlePost, requireTeamMember } from './huddle.js';
import { requireTeamMembership } from './permissions.js';
import { REDMINE, resolveTicketRef } from './ticket-refs.js';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

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
  async delivered({ id }, video) {
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
 * token); `delivered(destination, video)` is the note from an earlier
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

const DESTINATIONS = {
  library: {
    async check() {
      return {};
    },
    async delivered(_destination, video) {
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
    async delivered(_destination, video) {
      const post = await rawDb()
        .collection('huddlePosts')
        .findOne({ 'attachments.url': video.url }, { projection: { _id: 1 } });
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

  ticket: attachment('ticket', async (userId, { id }) => {
    requireId(id, 'ticket');
    if (!isValidId(id)) throw new Meteor.Error('not-found', 'Ticket not found');
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

  clock: attachment('clock', async (userId, { id }) => {
    requireId(id, 'clock session');
    if (!isValidId(id)) throw new Meteor.Error('not-found', 'Clock session not found');
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
 */
export async function resolvePulseDestination(userId, destination) {
  const kind = kindOf(destination);
  if (!kind) throw new Meteor.Error('bad-request', 'Unknown Pulse destination');
  return { kind: destination.kind, ...(await kind.check(userId, destination)) };
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
  const earlier = await kind.delivered(destination, video);
  if (earlier) return { state: 'done', note: earlier };
  try {
    await kind.check(userId, destination);
  } catch (err) {
    if (err instanceof Meteor.Error && (err.error === 'not-found' || err.error === 'forbidden')) {
      return { state: 'kept', reason: `${err.reason} — it was gone before the video finished uploading.` };
    }
    throw err;
  }
  return { state: 'done', note: await kind.deliver(userId, destination, video) };
}
