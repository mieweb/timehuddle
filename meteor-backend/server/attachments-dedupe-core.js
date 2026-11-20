/**
 * One video per target (huddle-server §12, D3): a video lands on a ticket or a
 * clock session once, however often its delivery is replayed. The rules here
 * are pure, so they are unit-tested; `attachments.js` and the startup
 * migration (`migrations/pulse-attachments-dedupe.js`) apply them to Mongo.
 * This file imports nothing from `meteor/*`.
 */

/** Mongo's error code for a write that violates a unique index. */
export const DUPLICATE_KEY_ERROR_CODE = 11000;

/**
 * The unique index that makes a video's attachment idempotent: one row per
 * `{url, attachedTo.kind, attachedTo.id}`, for videos only. Links and images
 * may repeat, so they stay out of it.
 */
export const VIDEO_TARGET_INDEX = Object.freeze({
  name: 'attachments_video_target_unique',
  keys: Object.freeze({ url: 1, 'attachedTo.kind': 1, 'attachedTo.id': 1 }),
  partialFilterExpression: Object.freeze({ type: 'video' }),
});

/** The Mongo filter for the one video attachment on a target: the index's fields. */
export function videoTargetFilter({ url, attachedTo }) {
  return { type: 'video', url, 'attachedTo.kind': attachedTo?.kind, 'attachedTo.id': attachedTo?.id };
}

// One index-key part: equal only where Mongo's index sees them equal, so a
// numeric id and its string never share a group. Missing counts as null, as
// it does in the index.
function keyPart(value) {
  if (value === undefined || value === null) return 'null';
  return `${typeof value}:${String(value)}`;
}

function targetKey(a) {
  return JSON.stringify([keyPart(a.url), keyPart(a.attachedTo?.kind), keyPart(a.attachedTo?.id)]);
}

function addedTime(a) {
  const time = a.addedAt instanceof Date ? a.addedAt.getTime() : Date.parse(a.addedAt);
  // A row with no readable date sorts last: a dated one is the one to keep.
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

const idText = (a) => (a._id?.toHexString ? a._id.toHexString() : String(a._id));

// Oldest first; equal dates by id, so every server picks the same row.
function olderFirst(a, b) {
  const byTime = addedTime(a) - addedTime(b);
  if (byTime !== 0) return byTime;
  const ia = idText(a);
  const ib = idText(b);
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

/**
 * The dedupe plan for `attachments` rows: group the videos by
 * `{url, attachedTo.kind, attachedTo.id}` and keep the oldest (`addedAt`) of
 * each group. Links and images are never touched.
 *
 * Returns `{ keep, remove, groups }`:
 * - `keep`: the row kept from each group that has duplicates,
 * - `remove`: the `_id`s of every other row in those groups,
 * - `groups`: how many targets had more than one video.
 */
export function planVideoDedupe(rows) {
  const byTarget = new Map();
  for (const row of rows) {
    if (row?.type !== 'video') continue;
    const key = targetKey(row);
    const group = byTarget.get(key);
    if (group) group.push(row);
    else byTarget.set(key, [row]);
  }
  const keep = [];
  const remove = [];
  let groups = 0;
  for (const group of byTarget.values()) {
    if (group.length < 2) continue;
    groups += 1;
    const [oldest, ...rest] = [...group].sort(olderFirst);
    keep.push(oldest);
    for (const row of rest) remove.push(row._id);
  }
  return { keep, remove, groups };
}

/** What a dedupe run logs: `{kept, removed, groups}`. */
export function dedupeCounts(plan) {
  return { kept: plan.keep.length, removed: plan.remove.length, groups: plan.groups };
}

/**
 * The attachment an insert that failed with `error` stands for. A duplicate
 * key is a replay of a video already on its target: the row already there
 * (`findExisting()`) is the answer, so a replay never throws. Anything else,
 * or a duplicate key with no such row to return, is rethrown.
 */
export async function existingOnDuplicate(error, findExisting) {
  if (error?.code !== DUPLICATE_KEY_ERROR_CODE) throw error;
  const existing = await findExisting();
  if (!existing) throw error;
  return existing;
}

const isText = (value) => typeof value === 'string' && value.trim() !== '';

/**
 * The optional Pulse fields of an attachment, as stored (§12). Only Pulse
 * deliveries write them: `source: 'pulse'`, `videoid` (the artifact id),
 * `pulseUploadId` (null for a link-flow upload) and `uploadType` (or null).
 * They belong to videos only. Returns `{ fields }`, empty when none is
 * given, or `{ error }`.
 */
export function pulseFieldsOf(type, { source, videoid, pulseUploadId, uploadType } = {}) {
  const given = [source, videoid, pulseUploadId, uploadType].some((v) => v !== undefined);
  if (!given) return { fields: {} };
  if (type !== 'video') return { error: 'Pulse fields are for videos only' };
  if (source !== 'pulse') return { error: "source must be 'pulse'" };
  if (!isText(videoid)) return { error: 'videoid is required' };
  if (pulseUploadId !== undefined && pulseUploadId !== null && !isText(pulseUploadId)) {
    return { error: 'Invalid pulseUploadId' };
  }
  if (uploadType !== undefined && uploadType !== null && !isText(uploadType)) {
    return { error: 'Invalid uploadType' };
  }
  return {
    fields: {
      source,
      videoid,
      pulseUploadId: pulseUploadId ?? null,
      uploadType: uploadType ?? null,
    },
  };
}
