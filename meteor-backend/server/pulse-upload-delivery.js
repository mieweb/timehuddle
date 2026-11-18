/**
 * Delivering a Pulse video sent from the app (huddle-server §8): PulseVault's
 * `onUploadComplete` for a video whose token names a `pulseUploads` row
 * calls deliverPulseUpload, and records what it returns as the upload's
 * outcome, which Pulse polls.
 *
 *  - A row whose place is one of pulse-destinations.js's kinds is delivered by
 *    deliverPulseVideo, as the link flow is, with what was current at Send
 *    (H4: the session a Huddle post joins) and the row it came from.
 *  - A clock type's video goes on the post its clock call made or appended to
 *    at Send (`session-post`), found by the postId stored on the row.
 *  - A video whose place is gone is kept: it shows in the uploader's library
 *    with why (`keptReason`).
 *  - The row records what the video became (media item, attachment, captions)
 *    and loses its overdue flag; the uploader gets one push.
 *
 * The rules are pure, in pulse-delivery-core.js. The overdue sweep
 * (pulse-uploads-sweep.js) is loaded from here.
 */
import { Meteor } from 'meteor/meteor';
import { MongoInternals } from 'meteor/mongo';

import { videoTargetFilter } from './attachments-dedupe-core.js';
import { rawDb, isObjectIdHex } from './collections.js';
import { createNotification } from './notify-core.js';
import {
  captionsOfId,
  deliveryDestinationOf,
  keptMediaUpdate,
  landedPush,
  landedRowFields,
  missingPush,
  sessionPostCheck,
  sessionPostDelivered,
  sessionPostFlagsCleared,
  sessionPostIdOf,
  sessionPostNote,
  sessionPostUpdate,
  withCaptions,
} from './pulse-delivery-core.js';
import { addToLibrary, deliverPulseVideo, postAttachment } from './pulse-destinations.js';
import { hookDecision, nextState } from './pulse-uploads-core.js';
import { pulseUploadsCollection, registerPulseCancelHandler } from './pulse-uploads.js';
import './pulse-uploads-sweep.js';
import { CANONICAL_ITEM } from './video-names.js';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

// pulse-captions.js reaches this file through pulsevault.js; load it when a video lands.
const captionsModule = () => import('./pulse-captions.js');

/** The rows a delivery may land on: under way, or given up on (a late video still attaches, O14). */
const DELIVERABLE = ['reserved', 'uploading', 'processing', 'canceled', 'abandoned', 'failed'];

/** What a row that landed says, as deliverPulseVideo said it the first time; null for one that hasn't. */
export function storedOutcome(row) {
  if (row?.state === 'delivered') return { state: 'done', note: row.note ?? null };
  if (row?.state === 'kept') return { state: 'kept', reason: row.reason ?? null };
  return null;
}

/**
 * The video's captions, which Pulse uploads before it (§11):
 * `{ captionsId, captionsUrl }`, both null when it has none. A lookup that
 * fails is logged and reads as none: the video still lands, and the captions
 * backfill (pulse-captions.js) fills its media item in later.
 */
async function captionsOf(artifactId) {
  try {
    const { captionsIdFor } = await captionsModule();
    return captionsOfId(await captionsIdFor(artifactId));
  } catch (err) {
    console.error(`[pulse-uploads] looking up the captions of ${artifactId} failed:`, err);
    return captionsOfId(null);
  }
}

/** A post id as stored on a row, as the post's `_id`; null for one that can't be. */
function postObjectId(postId) {
  return typeof postId === 'string' && isObjectIdHex(postId) ? new ObjectId(postId.toLowerCase()) : null;
}

const SESSION_POST_FIELDS = { projection: { _id: 1, userId: 1, attachments: 1 } };

/**
 * A clock type's video, onto the post its clock call made or appended to at
 * Send (§8.3): the post stored on the row, never one found by a query (#854).
 * A post that is gone keeps the video; one that has it already (a replay)
 * only loses its marks.
 */
async function deliverToSessionPost(row, video) {
  const posts = rawDb().collection('huddlePosts');
  const postId = postObjectId(sessionPostIdOf(row));
  let post = postId ? await posts.findOne({ _id: postId }, SESSION_POST_FIELDS) : null;
  let check = sessionPostCheck(post, row);
  if (check.kept) return { state: 'kept', reason: check.kept };
  if (!sessionPostDelivered(post, video)) {
    const mediaId = await addToLibrary(row.userId, video, { embedded: true });
    const write = sessionPostUpdate({
      postId,
      userId: row.userId,
      uploadId: row._id,
      attachment: postAttachment(mediaId, video),
      now: new Date(),
    });
    const { matchedCount } = await posts.updateOne(write.filter, write.update);
    if (matchedCount) return { state: 'done', note: sessionPostNote(row) };
    // Deleted meanwhile, or attached by a replay alongside: read it again.
    post = await posts.findOne({ _id: postId }, SESSION_POST_FIELDS);
    check = sessionPostCheck(post, row);
    if (check.kept) return { state: 'kept', reason: check.kept };
  }
  const cleared = sessionPostFlagsCleared({ postId, uploadId: row._id });
  await posts.updateOne(cleared.filter, cleared.update);
  return { state: 'done', note: sessionPostNote(row) };
}

/**
 * A kept video, in its uploader's library: its media item made (or no
 * longer embedded) and given the reason, which media.list shows (§8 step 4).
 * Returns the media item's id.
 */
async function keepInLibrary(row, video, reason) {
  const mediaId = await addToLibrary(row.userId, video);
  await rawDb()
    .collection('mediaitems')
    .updateMany({ videoid: video.artifactId, userId: row.userId }, keptMediaUpdate(reason));
  return mediaId;
}

/** What a delivered video became: its media item, its attachment (ticket, session) and its post. */
async function landedIds(row, video) {
  const db = rawDb();
  const item = await db
    .collection('mediaitems')
    .findOne({ videoid: video.artifactId }, { projection: { _id: 1 }, ...CANONICAL_ITEM });
  const destination = row.destination ?? {};
  let attachmentId = null;
  let postId = null;
  if (destination.kind === 'ticket' || destination.kind === 'clock') {
    const attachedTo = { kind: destination.kind, id: destination.id };
    const attachment = await db
      .collection('attachments')
      .findOne(videoTargetFilter({ url: video.url, attachedTo }), { projection: { _id: 1 } });
    attachmentId = attachment ? attachment._id.toHexString() : null;
  } else if (destination.kind === 'huddle') {
    const post = await db
      .collection('huddlePosts')
      .findOne(
        { teamId: destination.teamId, userId: row.userId, 'attachments.url': video.url },
        { projection: { _id: 1 } },
      );
    postId = post ? post._id.toHexString() : null;
  } else if (destination.kind === 'session-post') {
    postId = sessionPostIdOf(row);
  }
  return { mediaId: item ? item._id.toHexString() : null, attachmentId, postId };
}

/** Send a push (pulse-delivery-core.js builds it); a failure is logged, never the delivery's. */
async function notify(push) {
  if (!push) return;
  try {
    await createNotification(push);
  } catch (err) {
    console.error('[pulse-uploads] push failed:', err);
  }
}

/**
 * Deliver the video that finished uploading for row `uploadId` (`video`
 * as pulsevault.js describes it), and say how it went: `{ state: 'done',
 * note }` or `{ state: 'kept', reason }`. Idempotent: a replayed completion
 * of a row that landed returns its stored outcome and changes nothing.
 * Anything that may work later (a failed write) throws, so PulseVault
 * replays the completion.
 */
export async function deliverPulseUpload(uploadId, video) {
  const uploads = pulseUploadsCollection();
  const row = await uploads.findOne({ _id: uploadId });
  if (!row) return { state: 'kept', reason: 'This upload has no record on the server' };
  // An older artifact of the row (an Edit replaced it) finished anyway: the newer one is the video.
  if (hookDecision(row, { type: 'uploadComplete', artifactId: video.artifactId }, true).action !== 'deliver') {
    return { state: 'kept', reason: 'A newer send of this video replaced it' };
  }
  const stored = storedOutcome(row);
  if (stored) return stored;
  if (!row.destination) return { state: 'kept', reason: 'No destination on this upload' };

  const captions = await captionsOf(video.artifactId);
  const sent = withCaptions(video, captions.captionsUrl);
  const outcome =
    row.destination.kind === 'session-post'
      ? await deliverToSessionPost(row, sent)
      : await deliverPulseVideo(row.userId, deliveryDestinationOf(row), sent);
  const kept = outcome.state === 'kept';
  const landed = kept
    ? { mediaId: await keepInLibrary(row, video, outcome.reason), attachmentId: null, postId: null }
    : await landedIds(row, video);

  const to = nextState(row, { type: 'deliver', outcome: kept ? 'kept' : 'done' });
  const { matchedCount } = await uploads.updateOne(
    { _id: row._id, state: { $in: DELIVERABLE } },
    {
      $set: landedRowFields({
        to,
        outcome,
        mediaId: landed.mediaId,
        attachmentId: landed.attachmentId,
        captionsArtifactId: captions.captionsId,
        now: new Date(),
      }),
    },
  );
  if (!matchedCount) {
    // A replay running alongside landed it first: its outcome is the one recorded.
    const landedFirst = storedOutcome(await uploads.findOne({ _id: row._id }));
    if (landedFirst) return landedFirst;
    throw new Error(`[pulse-uploads] ${uploadId}: the row moved while its video was delivered`);
  }
  await notify(landedPush(row, { state: to, outcome, postId: landed.postId, artifactId: video.artifactId }));
  return outcome;
}

// A clock type's video that won't come: its uploader hears so, once (§9.4).
// The mark on its post is pulse-clock.js's own cancel handler. At startup:
// pulse-uploads.js may still be loading when this file is (an import cycle
// through pulsevault.js), and its handler list with it.
Meteor.startup(() => {
  registerPulseCancelHandler((stop) => notify(missingPush(stop)));
});
