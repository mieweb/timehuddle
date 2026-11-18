/**
 * Before videos get their unique index (huddle-server §12, D3): remove the
 * duplicate video attachments that find-then-insert left behind, keeping the
 * oldest of each `{url, attachedTo.kind, attachedTo.id}`, then create
 * `attachments_video_target_unique`.
 *
 * Run once across every server instance, guarded by a `migrations` marker
 * (`migration-claim.js`). With `DRY_RUN=1` it only logs the counts: no
 * deletes, no marker, no index. Takes the Mongo `db` and has no Meteor
 * imports, so it is testable.
 */
import {
  DUPLICATE_KEY_ERROR_CODE,
  VIDEO_TARGET_INDEX,
  dedupeCounts,
  planVideoDedupe,
} from '../attachments-dedupe-core.js';
import { runMigrationOnce } from '../migration-claim.js';

export const MARKER_ID = 'pulse-attachments-dedupe';

const LOG_PREFIX = '[attachments] video dedupe';

async function planFor(db) {
  const videos = await db
    .collection('attachments')
    .find({ type: 'video' }, { projection: { _id: 1, url: 1, type: 1, attachedTo: 1, addedAt: 1 } })
    .toArray();
  return planVideoDedupe(videos);
}

/** Remove every video attachment but the oldest on each target. Returns `{kept, removed, groups}`. */
export async function dedupeVideoAttachments(db, { log = console.log } = {}) {
  const plan = await planFor(db);
  const counts = dedupeCounts(plan);
  if (plan.remove.length) {
    const { deletedCount } = await db
      .collection('attachments')
      .deleteMany({ _id: { $in: plan.remove }, type: 'video' });
    counts.removed = deletedCount;
  }
  log(LOG_PREFIX, counts);
  return counts;
}

function createVideoTargetIndex(db) {
  return db.collection('attachments').createIndex(VIDEO_TARGET_INDEX.keys, {
    name: VIDEO_TARGET_INDEX.name,
    unique: true,
    partialFilterExpression: VIDEO_TARGET_INDEX.partialFilterExpression,
  });
}

/**
 * The startup step. A dry run logs `{kept, removed, groups}` as they would
 * be and changes nothing. Otherwise the dedupe runs once (marker), then the
 * index is created; creating it again is a no-op. Duplicates made after the
 * dedupe ran, before the index existed, fail the index: they are removed the
 * same way and the index is tried once more.
 */
export async function runPulseAttachmentsDedupe(db, { dryRun = false, log = console.log } = {}) {
  if (dryRun) {
    const counts = dedupeCounts(await planFor(db));
    log(`${LOG_PREFIX} (DRY_RUN, nothing changed)`, counts);
    return { dryRun: true, ...counts };
  }
  await runMigrationOnce(db, MARKER_ID, () => dedupeVideoAttachments(db, { log }));
  try {
    await createVideoTargetIndex(db);
  } catch (error) {
    if (error?.code !== DUPLICATE_KEY_ERROR_CODE) throw error;
    await dedupeVideoAttachments(db, { log });
    await createVideoTargetIndex(db);
  }
  return { dryRun: false };
}
