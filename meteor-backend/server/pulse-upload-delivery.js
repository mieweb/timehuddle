/**
 * Delivering a Pulse video sent from the app (huddle-server §8): PulseVault's
 * `onUploadComplete` for a video whose token names a `pulseUploads` row
 * calls deliverPulseUpload, and records what it returns as the upload's
 * outcome, which Pulse polls.
 *
 * A row whose place is one of pulse-destinations.js's kinds is delivered by
 * deliverPulseVideo, as the link flow is. A clock type's own post
 * (`session-post`) is delivered by PR3-S8, which extends this file with it,
 * the captions, the media and attachment ids and the push.
 */
import { deliverPulseVideo } from './pulse-destinations.js';
import { hookDecision, nextState } from './pulse-uploads-core.js';
import { pulseUploadsCollection } from './pulse-uploads.js';

/** The rows a delivery may land on: under way, or given up on (a late video still attaches, O14). */
const DELIVERABLE = ['reserved', 'uploading', 'processing', 'canceled', 'abandoned', 'failed'];

/** What a row that landed says, as deliverPulseVideo said it the first time; null for one that hasn't. */
export function storedOutcome(row) {
  if (row?.state === 'delivered') return { state: 'done', note: row.note ?? null };
  if (row?.state === 'kept') return { state: 'kept', reason: row.reason ?? null };
  return null;
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
  if (row.destination?.kind === 'session-post') {
    // Thrown, so PulseVault keeps the completion and replays it once delivery to the post exists.
    throw new Error(`[pulse-uploads] ${uploadId}: delivery to a clock post is not available yet`);
  }
  if (!row.destination) return { state: 'kept', reason: 'No destination on this upload' };

  const outcome = await deliverPulseVideo(row.userId, row.destination, video);
  const to = nextState(row, { type: 'deliver', outcome: outcome.state === 'kept' ? 'kept' : 'done' });
  const now = new Date();
  const { matchedCount } = await uploads.updateOne(
    { _id: row._id, state: { $in: DELIVERABLE } },
    {
      $set: {
        state: to,
        note: outcome.note ?? null,
        reason: outcome.reason ?? null,
        deliveredAt: now,
        updatedAt: now,
      },
    },
  );
  if (!matchedCount) {
    // A replay running alongside landed it first: its outcome is the one recorded.
    const landed = storedOutcome(await uploads.findOne({ _id: row._id }));
    if (landed) return landed;
    throw new Error(`[pulse-uploads] ${uploadId}: the row moved while its video was delivered`);
  }
  return outcome;
}
