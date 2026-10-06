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
import { requireTeamMembership } from './permissions.js';
import { REDMINE, resolveTicketRef } from './ticket-refs.js';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

function requireId(id, what) {
  if (typeof id !== 'string' || !id) throw new Meteor.Error('bad-request', `Invalid ${what} id`);
}

/**
 * Attach the video to a ticket or Redmine issue. One attachment per video
 * and place, so a replayed completion finds the first one.
 */
async function attachVideo(userId, attachedTo, video) {
  const note = `Attached to ${attachedTo.kind} ${attachedTo.id}`;
  const existing = await rawDb()
    .collection('attachments')
    .findOne(
      { url: video.url, 'attachedTo.kind': attachedTo.kind, 'attachedTo.id': attachedTo.id },
      { projection: { _id: 1 } },
    );
  if (existing) return note;
  await createAttachment({ url: video.url, type: 'video', title: video.title, attachedTo, addedBy: userId });
  return note;
}

const DESTINATIONS = {
  library: {
    async check() {
      return {};
    },
    async deliver(userId, _destination, video) {
      const media = rawDb().collection('mediaitems');
      const note = 'Added to the media library';
      if (await media.findOne({ videoid: video.artifactId }, { projection: { _id: 1 } })) return note;
      await media.insertOne({
        _id: new ObjectId(),
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
      return note;
    },
  },

  ticket: {
    async check(userId, { id }) {
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
    },
    deliver: (userId, { id }, video) => attachVideo(userId, { kind: 'ticket', id }, video),
  },

  // An issue the uploader's own Redmine key can see (attachments.add's own check).
  [REDMINE]: {
    async check(userId, { id }) {
      requireId(id, 'Redmine issue');
      await resolveTicketRef(userId, REDMINE, id);
      return { id };
    },
    deliver: (userId, { id }, video) => attachVideo(userId, { kind: REDMINE, id }, video),
  },
};

/** Every destination kind, for the reserve method's schema. */
export const PULSE_DESTINATION_KINDS = Object.keys(DESTINATIONS);

function kindOf(destination) {
  // Own keys only: `constructor` and friends aren't destinations.
  const kind = Object.hasOwn(DESTINATIONS, destination?.kind ?? '') ? DESTINATIONS[destination.kind] : null;
  if (!kind) throw new Meteor.Error('bad-request', 'Unknown Pulse destination');
  return kind;
}

/**
 * Check that `destination` is somewhere `userId` may send a Pulse video, and
 * return the form to sign into the token. Throws a Meteor.Error if not.
 */
export async function resolvePulseDestination(userId, destination) {
  const fields = await kindOf(destination).check(userId, destination);
  return { kind: destination.kind, ...fields };
}

/**
 * Deliver a finished video to the destination its token carried, and say how
 * it went: `{ state: 'done', note }`, or `{ state: 'kept', reason }` when the
 * destination is gone for good (the ticket was deleted, the uploader left its
 * team) — the video stays in storage, and the status route says why. Anything
 * else (Redmine unreachable, a write failed) is thrown, so PulseVault replays
 * the completion later.
 *
 * `video` is `{ artifactId, url, title, filename, mimeType, size }`.
 */
export async function deliverPulseVideo(userId, destination, video) {
  const kind = kindOf(destination);
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
