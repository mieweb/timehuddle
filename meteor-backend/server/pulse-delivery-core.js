/**
 * How a Pulse video sent from the app lands, with no Meteor or database
 * (huddle-server §8, §10, §11, §14): pulse-upload-delivery.js,
 * pulse-destinations.js, pulse-uploads-sweep.js and uploads.js run these
 * against the collections.
 *
 *  - A clock type's video (`clock.wrapup`, `clock.plan`) goes on the post its
 *    clock call made or appended to at Send (`session-post`), found by the
 *    postId stored on the row, never by a query (#854: a session's other
 *    posts are updates, SESSION_POST_FILTER). Delivery adds the video and
 *    clears the post's pending and missing marks; it never touches the post's
 *    session fields, so a plan post stays a plan post.
 *  - A Huddle post (`huddle.post`) joins the clock session the uploader was in
 *    at Send (H4, stored as the row's `sessionId`) as an update post, the way
 *    a typed post written while clocked in does (Q8, #854 joinOpenSession).
 *  - A video whose place is gone is kept in the uploader's library, with why.
 *  - Captions found at delivery travel with the video (`captionsUrl`).
 *  - The pushes: delivered, kept, overdue (24 h after Send, clock types, once)
 *    and missing (a clock video PulseVault gave up on).
 *  - Account deletion: which Pulse rows, media and attachments go.
 */
import { captionsIdOf, captionsUrlOf, isArtifactId } from './pulse-captions-core.js';
import { isClockType, OVERDUE_STATES } from './pulse-uploads-core.js';

// ─── Captions ────────────────────────────────────────────────────────────────

/**
 * A video's captions by their artifact id (`captionsIdFor`'s answer):
 * `{ captionsId, captionsUrl }`, both null for none.
 * @param {string | null | undefined} id
 */
export function captionsOfId(id) {
  const captionsId = isArtifactId(id) ? id : null;
  return { captionsId, captionsUrl: captionsUrlOf({ captionsId }) };
}

/**
 * A video's captions at delivery, from PulseVault's `getPulse` (`pulse`; null
 * when it couldn't be read): `{ captionsId, captionsUrl }`, both null when it
 * has none.
 */
export function captionsAtDelivery(pulse) {
  return captionsOfId(captionsIdOf(pulse));
}

/** `video` as delivery passes it on: with its captions' URL when it has one. */
export function withCaptions(video, captionsUrl) {
  return captionsUrl ? { ...video, captionsUrl } : video;
}

// ─── Post attachments ────────────────────────────────────────────────────────

/**
 * The attachment shape a Huddle post stores for a Pulse video, with its
 * captions when known (`video.captionsUrl`).
 * @param {string} mediaId
 * @param {any} video
 */
export function postAttachment(mediaId, video) {
  return {
    mediaId,
    type: 'video',
    url: video.url,
    filename: video.title,
    ...(video.captionsUrl ? { captionsUrl: video.captionsUrl } : {}),
  };
}

/**
 * The Pulse fields a ticket's or session's video attachment stores (§12):
 * the video's id, and the row it came from (`destination.pulseUploadId`,
 * `destination.uploadType`; null for a link-flow upload). Empty for a video
 * with no artifact id.
 * @param {any} video
 * @param {any} destination
 */
export function pulseAttachmentFields(video, destination) {
  if (typeof video?.artifactId !== 'string' || !video.artifactId) return {};
  return {
    source: 'pulse',
    videoid: video.artifactId,
    pulseUploadId: destination?.pulseUploadId ?? null,
    uploadType: destination?.uploadType ?? null,
  };
}

// ─── Where a row's video goes ────────────────────────────────────────────────

/**
 * The destination a row's video is delivered to (pulse-destinations.js'
 * form): its resolved destination, plus the row it came from (for the
 * attachment's fields) and, for a Huddle post, what was current at Send (H4):
 * `sessionUpdateId` (the uploader's session then) and `conversationId`
 * (passed through; null until #871, PR3-R uses it).
 * @param {any} row
 */
export function deliveryDestinationOf(row) {
  const destination = row?.destination;
  if (!destination?.kind) return null;
  const from = { pulseUploadId: row._id ?? null, uploadType: row.type ?? null };
  if (destination.kind !== 'huddle') return { ...destination, ...from };
  return {
    ...destination,
    ...from,
    sessionUpdateId: row.sessionId ?? null,
    conversationId: row.conversationId ?? null,
  };
}

// ─── Session posts (clock.wrapup, clock.plan) ────────────────────────────────

export const SESSION_POST_NOTES = Object.freeze({
  wrapup: 'Wrap-up video added',
  plan: 'Plan video added',
});

export const SESSION_POST_GONE = 'The post this video was sent to is gone';

/** The post a clock type's video goes on: the one stored at Send. */
export function sessionPostIdOf(row) {
  return row?.destination?.postId ?? row?.postId ?? null;
}

/** The note a session post's delivery returns. */
export function sessionPostNote(row) {
  return SESSION_POST_NOTES[row?.destination?.role] ?? 'Video added';
}

/**
 * Whether the post (as read by its stored id) may still take the row's
 * video: `{ ok: true }`, or `{ kept: reason }` when it was deleted or isn't
 * the uploader's.
 * @param {any} post
 * @param {any} row
 */
export function sessionPostCheck(post, row) {
  if (!post || post.userId !== row?.userId) return { kept: SESSION_POST_GONE };
  return { ok: true };
}

/** Whether the post already carries the video (a replayed completion). */
export function sessionPostDelivered(post, video) {
  return Array.isArray(post?.attachments) && post.attachments.some((att) => att?.url === video?.url);
}

/** The marks a post carries for a video on its way (§9.4), cleared once it lands. */
function flagsCleared(uploadId) {
  return { pendingVideos: { uploadId }, missingVideos: { uploadId } };
}

/**
 * The one write that puts the video on its post: the attachment (with
 * captions) pushed unless the post has it, and the post's pending and
 * missing marks for this upload pulled. `postId` is the stored id as the
 * caller converts it. Session fields (`clockEventId`, `sessionUpdate`) are
 * never written: a plan stays a plan, an update stays an update.
 * @param {{ postId: any, userId: string, uploadId: string, attachment: any, now: Date }} args
 */
export function sessionPostUpdate({ postId, userId, uploadId, attachment, now }) {
  return {
    filter: { _id: postId, userId, 'attachments.url': { $ne: attachment.url } },
    update: {
      $push: { attachments: attachment },
      $pull: flagsCleared(uploadId),
      $set: { updatedAt: now },
    },
  };
}

/**
 * The write a replay runs when the video is already on its post: only the
 * marks go (a delivery that stopped after the attachment).
 * @param {{ postId: any, uploadId: string }} args
 */
export function sessionPostFlagsCleared({ postId, uploadId }) {
  return { filter: { _id: postId }, update: { $pull: flagsCleared(uploadId) } };
}

// ─── Huddle posts (huddle.post) ──────────────────────────────────────────────

/**
 * A session's plan or wrap-up post: linked to a session, not as an update.
 * A delivered video never turns one into an update post.
 */
export function isPlanPost(post) {
  return post?.clockEventId != null && post.sessionUpdate !== true;
}

/**
 * The createHuddlePost options for a Huddle post sent in session `sessionId`
 * (H4), given the uploader's session open now (`openSessionId`): still that
 * one, main's `joinOpenSession` links it as an update. Otherwise (the session
 * ended since Send, or there was none) the post is made unlinked and
 * deliveredPostUpdate links it to the session at Send.
 * @param {{ sessionId?: string | null, openSessionId?: string | null }} args
 */
export function huddlePostOptions({ sessionId, openSessionId }) {
  return { joinOpenSession: Boolean(sessionId) && sessionId === openSessionId };
}

/**
 * What a Huddle post carrying the video still needs, as one update, or null:
 *  - linked to `sessionId` (the session at Send) as an update post, unless it
 *    is already, or is a plan post (never made an update);
 *  - the video's captions (`captionsUrl`) on its attachment, which
 *    createHuddlePost's attachment check doesn't keep.
 * `post` is `{ _id, userId, clockEventId?, sessionUpdate?, attachments? }`.
 * The filter holds the post to what was read, so a post that became a plan
 * meanwhile isn't linked.
 * @param {{ post: any, sessionId?: string | null, captionsUrl?: string | null, videoUrl: string }} args
 */
export function deliveredPostUpdate({ post, sessionId, captionsUrl, videoUrl }) {
  if (!post) return null;
  const join = Boolean(sessionId) && !isPlanPost(post) && !(post.clockEventId === sessionId && post.sessionUpdate === true);
  const needsCaptions =
    Boolean(captionsUrl) &&
    (post.attachments ?? []).some((att) => att?.url === videoUrl && att.captionsUrl !== captionsUrl);
  if (!join && !needsCaptions) return null;
  const $set = {
    ...(join ? { clockEventId: sessionId, sessionUpdate: true } : {}),
    ...(needsCaptions ? { 'attachments.$[video].captionsUrl': captionsUrl } : {}),
  };
  return {
    filter: {
      _id: post._id,
      userId: post.userId,
      // Not a plan post: unlinked, or already an update.
      ...(join ? { $or: [{ clockEventId: null }, { sessionUpdate: true }] } : {}),
    },
    update: { $set },
    ...(needsCaptions ? { options: { arrayFilters: [{ 'video.url': videoUrl }] } } : {}),
  };
}

// ─── Kept ────────────────────────────────────────────────────────────────────

/**
 * A kept video's media item: in the uploader's library (not embedded), with
 * why it was kept, which media.list shows.
 * @param {string | null | undefined} reason
 */
export function keptMediaUpdate(reason) {
  return { $set: { keptReason: reason ?? 'Kept in your library' }, $unset: { embedded: '' } };
}

// ─── The row once its video landed ───────────────────────────────────────────

/**
 * The row's fields once delivery returned `outcome` and moved it `to`
 * delivered or kept: the note or reason, what it became (`mediaId`,
 * `attachmentId`), its captions, and the overdue flag cleared (O14).
 * @param {{ to: string, outcome: any, mediaId?: string | null, attachmentId?: string | null, captionsArtifactId?: string | null, now: Date }} args
 */
export function landedRowFields({ to, outcome, mediaId, attachmentId, captionsArtifactId, now }) {
  return {
    state: to,
    note: outcome?.note ?? null,
    reason: outcome?.reason ?? null,
    mediaId: mediaId ?? null,
    attachmentId: attachmentId ?? null,
    captionsArtifactId: captionsArtifactId ?? null,
    overdueAt: null,
    deliveredAt: now,
    updatedAt: now,
  };
}

// ─── Pushes ──────────────────────────────────────────────────────────────────

/** The Huddle link to a post, as huddle-delivery.js' huddlePostUrl writes it. */
export function huddlePostPath(teamId, postId) {
  return `/app/huddle?team=${encodeURIComponent(teamId)}&post=${encodeURIComponent(postId)}`;
}

/**
 * The page a push about `row` opens: a kept video's watch page; a ticket's
 * page; the Clock page for a session, wrap-up or plan; a Huddle post (or the
 * team's Huddle); else the video's watch page.
 * @param {any} row
 * @param {{ state?: string, postId?: string | null, artifactId?: string | null }} [landed]
 */
export function pushUrlOf(row, { state, postId, artifactId } = {}) {
  const videoId = artifactId ?? row?.artifactId ?? null;
  const watch = videoId ? `/watch/${encodeURIComponent(videoId)}` : '/app/media';
  if (state === 'kept') return watch;
  const destination = row?.destination ?? {};
  switch (destination.kind) {
    case 'ticket':
      return destination.id ? `/app/tickets/${encodeURIComponent(destination.id)}` : '/app/tickets';
    case 'clock':
    case 'session-post':
      return '/app/clock';
    case 'huddle':
      if (!destination.teamId) return '/app/huddle';
      return postId ? huddlePostPath(destination.teamId, postId) : `/app/huddle?team=${encodeURIComponent(destination.teamId)}`;
    default:
      return watch;
  }
}

const ROLE_NAMES = Object.freeze({ wrapup: 'wrap-up', plan: 'plan' });

/** What a clock type's video is called in a sentence ("wrap-up", "plan"). */
function roleOf(row) {
  return ROLE_NAMES[row?.destination?.role] ?? (row?.type === 'clock.plan' ? 'plan' : 'wrap-up');
}

/** Where the push says the video went. */
function placeOf(row) {
  if (row?.destination?.kind === 'session-post') return `your ${roleOf(row)}`;
  return row?.label || 'its place';
}

/** The `data` every Pulse upload push carries (§10). */
function pushData(row, state, url) {
  return { type: 'pulse-upload', uploadId: row?._id ?? null, state, url };
}

/**
 * The push once a row's video landed (`state`: delivered or kept, `outcome`
 * delivery's), for createNotification: "Video attached to <label>", or
 * "Saved to your library: <reason>".
 * @param {any} row
 * @param {{ state: string, outcome?: any, postId?: string | null, artifactId?: string | null }} landed
 */
export function landedPush(row, { state, outcome, postId, artifactId }) {
  const url = pushUrlOf(row, { state, postId, artifactId });
  if (state === 'kept') {
    const reason = String(outcome?.reason ?? 'its place was gone').replace(/\.$/, '');
    return {
      userId: row.userId,
      title: 'Video saved to your library',
      body: `Saved to your library: ${reason}`,
      data: pushData(row, state, url),
    };
  }
  return {
    userId: row.userId,
    title: 'Video delivered',
    body: `Video attached to ${placeOf(row)}`,
    data: pushData(row, state, url),
  };
}

/** What the person's phone is called in a push, from the row's platform. */
function phoneOf(row) {
  if (row?.platform === 'ios') return 'iPhone';
  if (row?.platform === 'android') return 'Android phone';
  return 'phone';
}

/**
 * The one push for a clock type's video that hasn't arrived 24 h after Send
 * (O14: it still attaches if it comes), or null for any other type.
 * @param {any} row
 */
export function overduePush(row) {
  if (!isClockType(row?.type)) return null;
  const role = roleOf(row);
  return {
    userId: row.userId,
    title: `${role === 'plan' ? 'Plan' : 'Wrap-up'} video hasn't arrived`,
    body: `Your ${role} video hasn't arrived yet. Open TimeHuddle on your ${phoneOf(row)} to send it.`,
    data: pushData(row, row.state, pushUrlOf(row)),
  };
}

/**
 * The push for a clock type's video that won't come (§9.4): PulseVault gave
 * up on its upload. Null for other types, and for a draft the person deleted
 * themselves, which they already know about.
 * @param {{ row: any, to: string, reason?: string }} stop
 */
export function missingPush({ row, to, reason }) {
  if (to !== 'abandoned' || reason === 'deleted' || !isClockType(row?.type)) return null;
  const role = roleOf(row);
  return {
    userId: row.userId,
    title: `${role === 'plan' ? 'Plan' : 'Wrap-up'} video didn't arrive`,
    body: `${role === 'plan' ? 'Plan' : 'Wrap-up'} video didn't arrive`,
    data: pushData(row, to, pushUrlOf(row)),
  };
}

// ─── Sweep ───────────────────────────────────────────────────────────────────

/** How often the overdue sweep runs. */
export const PULSE_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** How many rows one pass marks at a time. */
export const PULSE_SWEEP_BATCH = 200;

/**
 * The sweep's interval: `PULSE_UPLOADS_SWEEP_MS` from the environment (a
 * test backend runs it every few seconds), else hourly. At least a second.
 * @param {string | undefined} value
 */
export function sweepIntervalMs(value) {
  const ms = Number(value);
  return Number.isInteger(ms) && ms >= 1000 ? ms : PULSE_SWEEP_INTERVAL_MS;
}

/**
 * The write that marks one row overdue, once: only while its video still
 * hasn't landed and it isn't marked yet, so two sweeps push once.
 * @param {any} row
 * @param {Date} now
 */
export function overdueMark(row, now) {
  return {
    filter: { _id: row._id, state: { $in: [...OVERDUE_STATES] }, overdueAt: null },
    update: { $set: { overdueAt: now } },
  };
}

/**
 * The mark on a clock type's post that its video hasn't arrived yet ("Wrap-up
 * video hasn't arrived yet"): the post's pending entry for the upload gets
 * `overdueAt`. Delivery pulls the entry, which clears it. Null for a row with
 * no post.
 * @param {{ row: any, postId: any, now: Date }} args
 */
export function overduePostMark({ row, postId, now }) {
  if (!isClockType(row?.type) || postId == null) return null;
  return {
    filter: { _id: postId, userId: row.userId, 'pendingVideos.uploadId': row._id },
    update: { $set: { 'pendingVideos.$.overdueAt': now } },
  };
}

// ─── Account deletion ────────────────────────────────────────────────────────

/** Rows whose video hasn't landed: cancelled first when the account goes. */
export const UNFINISHED_STATES = Object.freeze(['intent', 'reserved', 'uploading', 'processing']);

export const ACCOUNT_DELETED_REASON = 'The account was deleted';

/**
 * What `DELETE /api/me/account` removes of the user's Pulse videos (§14):
 *  - `cancel`: their unfinished rows, cancelled first, so PulseVault refuses
 *    anything more for them;
 *  - `videoItems`: their media items with a video (each one's artifacts go too);
 *  - `attachments`: the video attachments they added;
 *  - `uploads`: every row of theirs, deleted last.
 * @param {string} userId
 * @param {Date} now
 */
export function accountPulseCleanup(userId, now) {
  return {
    cancel: {
      filter: { userId, state: { $in: [...UNFINISHED_STATES] } },
      update: { $set: { state: 'canceled', reason: ACCOUNT_DELETED_REASON, updatedAt: now } },
    },
    videoItems: { userId, videoid: { $type: 'string' } },
    attachments: { addedBy: userId, type: 'video' },
    uploads: { userId },
  };
}

/**
 * Every PulseVault video of the user's to remove: their media items' videos,
 * and their rows' artifacts (current and replaced), which an unfinished
 * upload has without a media item. Each once.
 * @param {any[]} rows
 * @param {any[]} items
 */
export function artifactsToRemove(rows, items) {
  const ids = new Set();
  for (const item of items ?? []) if (typeof item?.videoid === 'string' && item.videoid) ids.add(item.videoid);
  for (const row of rows ?? []) {
    for (const id of [row?.artifactId, ...(row?.replacedArtifactIds ?? [])]) {
      if (typeof id === 'string' && id) ids.add(id);
    }
  }
  return [...ids];
}

