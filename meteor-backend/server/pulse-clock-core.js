/**
 * Clocking in or out with a Pulse video, at Send (huddle-server §9; PLAN
 * AD23, O13–O15), with no Meteor or database: the methods' schemas and rate
 * limits, their arguments, the wrap-up line, the post they write, what is
 * left to do for a call given what already exists, and how a post shows the
 * videos it is waiting for. pulse-clock.js runs it.
 *
 * At Send, before Pulse closes, Huddle calls `clock.stopWithVideo` or
 * `clock.startWithPlan` with `at` = the Send. One call, three steps:
 *  1. `intent`: the draft's `pulseUploads` row (pulse-uploads.js's
 *     insertIntent), so its uploadId exists before anything names it;
 *  2. `post`: the wrap-up line appended to the session's post, or the plan
 *     post made, each carrying `pendingVideos: [{uploadId, role, at}]`. The
 *     wrap-up sets `wrapUpAt`, so the plan-first gate in clockStop passes
 *     with no change to it;
 *  3. `clock`: clockStop or clockStart at `at`.
 * A retry (the call timed out, or failed after a step) finds what the last
 * one left, and runs only the steps it didn't finish (clockCallSteps). The
 * call is idempotent per (userId, draftKey) (PLAN AD32): a second Send of
 * the same draft, edited or not, changes nothing and answers as the first.
 *
 * The video lands later and only attaches to that post (pulse-upload-
 * delivery.js); it never clocks anyone. If it never comes (its draft is
 * deleted, or sending is cancelled), the post is marked missing it instead
 * (missingVideoWrite), and the clock record stays as it is (Q1).
 */
import { clientTimeOrNow } from './client-time-core.js';
import { isClockType, normalizeTarget, pulseUploadType, targetKeyOf } from './pulse-upload-types.js';
import { isDraftKey, uploadSizeRefusal } from './pulse-uploads-core.js';
import { cleanVideoName } from './video-names-core.js';

const MINUTE_MS = 60 * 1000;

/**
 * The two calls: the upload type each makes a row for, and its clock action.
 * Thirty a minute per user each: one per Send, plus Try again.
 */
export const PULSE_CLOCK_CALLS = Object.freeze({
  'clock.stopWithVideo': Object.freeze({ type: 'clock.wrapup', clock: 'stop', role: 'wrapup' }),
  'clock.startWithPlan': Object.freeze({ type: 'clock.plan', clock: 'start', role: 'plan' }),
});

export const PULSE_CLOCK_LIMIT = Object.freeze({ limit: 30, windowMs: MINUTE_MS });

// ─── Schemas ─────────────────────────────────────────────────────────────────

const ARGS = {
  teamId: { type: 'string', maxLength: 64 },
  postDate: { type: 'string', description: "YYYY-MM-DD: the poster's calendar day" },
  at: { type: 'number', description: 'ms epoch of Send (device time); older than 30 minutes reads as now' },
  draftKey: { type: 'string', maxLength: 200, description: '<installationId>:<draftId>; the call is idempotent per draftKey' },
  bytes: { type: 'number', description: 'The merged video, so a too-large one is refused before any clock change' },
  name: { type: ['string', 'null'], description: "The draft's name" },
};

const CLOCK_EVENT = {
  type: 'object',
  description: 'The clock session as the server recorded it (ClockEvent): its startTime / endTime are what to show',
};

const RESULT = (extra = {}) => ({
  type: 'object',
  properties: {
    uploadId: { type: 'string', description: 'The pulseUploads row the video will be sent under' },
    postId: { type: 'string', description: 'The post the video attaches to' },
    clockEvent: CLOCK_EVENT,
    ...extra,
  },
});

const limitText = ({ limit, windowMs }) => `Limited to ${limit} calls per ${windowMs / 1000} s per user.`;

/** Each call's schema and rate limit, in the shape pulse-uploads-expose-core.js registers and exposes. */
export const PULSE_CLOCK_METHODS = Object.freeze({
  'clock.stopWithVideo': Object.freeze({
    rateLimit: PULSE_CLOCK_LIMIT,
    description:
      'Clock out at Send with a Pulse wrap-up video on its way: appends the wrap-up line to the session post (which passes the plan-first gate), records the video as expected there, and ends the session at `at`. Idempotent per draftKey; a too-large video changes nothing. ' +
      limitText(PULSE_CLOCK_LIMIT),
    inputSchema: {
      type: 'object',
      properties: {
        ...ARGS,
        clockEventId: { type: 'string', maxLength: 64, description: 'The open session to end' },
      },
      required: ['teamId', 'clockEventId', 'postDate', 'at', 'draftKey'],
    },
    outputSchema: RESULT(),
  }),
  'clock.startWithPlan': Object.freeze({
    rateLimit: PULSE_CLOCK_LIMIT,
    description:
      'Clock in at Send with a Pulse plan video on its way: makes the plan post, records the video as expected there, and starts a session at `at` with that plan. Idempotent per draftKey; a too-large video changes nothing. ' +
      limitText(PULSE_CLOCK_LIMIT),
    inputSchema: {
      type: 'object',
      properties: { ...ARGS },
      required: ['teamId', 'postDate', 'at', 'draftKey'],
    },
    outputSchema: RESULT({ conversationId: { type: 'string', description: 'Where the plan post landed, when the team has conversations' } }),
  }),
});

// ─── Arguments ───────────────────────────────────────────────────────────────

const POST_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TEAM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const OBJECT_ID_RE = /^[0-9a-f]{24}$/i;

const badRequest = (reason) => ({ error: 'bad-request', reason });
const isCount = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/**
 * A clock call's arguments (`name`: a PULSE_CLOCK_CALLS key) checked for
 * `userId`: `{ value }` or a refusal `{ error, reason }`. A video over the
 * size cap is refused here, before anything is read or written (O15).
 * `value.target`/`targetKey` are the row's, as begin will name them;
 * `clockEventId` is lowercased, as the row and its key keep it; `teamId` is
 * kept as sent, since clock sessions store it that way.
 *
 * @param {string} name
 * @param {string} userId
 * @param {any} args
 * @returns {{ value?: any, error?: string, reason?: string }}
 */
export function checkClockCallArgs(name, userId, args) {
  const call = PULSE_CLOCK_CALLS[name];
  if (!call) return badRequest('Not a clock call');
  if (!args || typeof args !== 'object') return badRequest('Missing arguments');
  const { teamId, clockEventId, postDate, at, draftKey, bytes } = args;
  if (typeof teamId !== 'string' || !TEAM_ID_RE.test(teamId)) return badRequest('teamId is required');
  if (call.clock === 'stop' && (typeof clockEventId !== 'string' || !OBJECT_ID_RE.test(clockEventId))) {
    return badRequest('clockEventId is required');
  }
  if (typeof postDate !== 'string' || !POST_DATE_RE.test(postDate)) return badRequest('postDate must be YYYY-MM-DD');
  if (typeof at !== 'number' || !Number.isFinite(at)) return badRequest('at is required');
  if (!isDraftKey(draftKey)) return badRequest('Invalid draftKey');
  if (bytes != null && !isCount(bytes)) return badRequest('Invalid bytes');
  if (args.name != null && typeof args.name !== 'string') return badRequest('Invalid name');
  const tooLarge = uploadSizeRefusal(call.type, bytes);
  if (tooLarge) return tooLarge;

  const target = normalizeTarget(
    call.type,
    call.clock === 'stop' ? { kind: 'clock', id: clockEventId } : { kind: 'clock-plan', teamId, postDate },
  );
  const targetKey = target && targetKeyOf(call.type, target, userId);
  if (!targetKey) return badRequest('Invalid target for this clock call');
  return {
    value: {
      ...call,
      teamId,
      clockEventId: call.clock === 'stop' ? target.id : null,
      postDate,
      at,
      draftKey,
      bytes: bytes ?? null,
      name: cleanVideoName(args.name),
      target,
      targetKey,
    },
  };
}

// ─── Time ────────────────────────────────────────────────────────────────────

/**
 * When the clock action of a Send at `at` (ms) is recorded: `at`, as
 * clock.js's clientTimeOrNow takes a press time, so older than 30 minutes
 * (or ahead of the server) reads as `now`. The row keeps it as `sentAt`, and
 * a retry clocks at it again (O13). clockStop/clockStart still hold it to the
 * session (never before it started); the clockEvent they return is what the
 * person is told.
 */
export function clockActionTime(at, now) {
  return clientTimeOrNow(at, now);
}

// ─── What the call writes ────────────────────────────────────────────────────

/**
 * The line a wrap-up adds under the session post's plan: today's words, as
 * the link flow's wrap-up writes them (pulse-destinations.js). The one place
 * they are built for a Pulse wrap-up, so a change on main (#857) is a change
 * here.
 */
export function wrapUpLine(name) {
  const cleaned = cleanVideoName(name);
  return cleaned ? `**Wrap-up:** ${cleaned}` : '**Wrap-up**';
}

/** One entry of a post's `pendingVideos` (a video on its way) or `missingVideos` (one that won't come). */
export function videoMark(uploadId, role, at) {
  return { uploadId, role, at: new Date(at) };
}

/**
 * huddle.js's appendWrapUp options for a wrap-up sent at `at`: the line, no
 * attachment (the video attaches when it lands), and the video expected.
 * appendWrapUp finds the session's post with SESSION_POST_FILTER, so an
 * update post never takes it, and makes one when the session has none.
 */
export function wrapUpOptions(value, uploadId, at) {
  return {
    teamId: value.teamId,
    clockEventId: value.clockEventId,
    postDate: value.postDate,
    line: wrapUpLine(value.name),
    attachment: null,
    pendingVideo: videoMark(uploadId, 'wrapup', at),
  };
}

/**
 * huddle.js's createHuddlePost options for a plan sent at `at`: the draft's
 * name as its text (as a plan the link flow posts), no attachment yet, and
 * the video expected. No session and no joinOpenSession, so it is never an
 * update post (#854): clockStart links it as the session's plan.
 */
export function planPostOptions(value, uploadId, at) {
  return {
    teamId: value.teamId,
    content: { text: value.name ?? '', mentions: [] },
    attachments: [],
    postDate: value.postDate,
    pendingVideos: [videoMark(uploadId, 'plan', at)],
  };
}

// ─── Steps ───────────────────────────────────────────────────────────────────

/**
 * Whether a post can be a session's plan/wrap-up post: published, and not an
 * update (huddle.js's SESSION_POST_FILTER, #854). An update joins a session
 * but never carries its plan or wrap-up, and never satisfies the plan gate.
 */
export function isSessionPost(post) {
  return !!post && post.sessionUpdate !== true && post.status !== 'draft';
}

const idOf = (id) => (id && typeof id.toHexString === 'function' ? id.toHexString() : id == null ? null : String(id));
const marks = (list, uploadId) => Array.isArray(list) && list.some((mark) => mark?.uploadId === uploadId);

/**
 * The post a clock call already wrote for `row` among `posts`: the one the
 * row names (`postId`), else one that carries the row's video as expected or
 * missing (a call that stopped after writing it, before recording it). An
 * update post never counts, so a wrap-up that somehow sits on one is written
 * again where the plan gate looks.
 *
 * @param {any} row
 * @param {any[] | null | undefined} posts
 * @returns {any}
 */
export function markedPostOf(row, posts) {
  if (!row) return null;
  const candidates = (posts ?? []).filter(isSessionPost);
  const named = row.postId && candidates.find((post) => idOf(post._id) === idOf(row.postId));
  return (
    named ||
    candidates.find((post) => marks(post.pendingVideos, row._id) || marks(post.missingVideos, row._id)) ||
    null
  );
}

/**
 * What is left of a clock call (`clock`: 'stop' or 'start'), from what
 * exists: `row` (the draft's clock row, null for none), `posts` (posts that
 * may be the call's) and, for a stop, `session` (the session it ends; a
 * plan is clocked in once its post is linked to one). Returns `{ steps, postId }`:
 * `steps` in order, of `intent` (insert the row), `post` (append the wrap-up
 * or make the plan post) and `clock` (clockStop or clockStart); `postId` is
 * the call's post when it exists. Nothing left is a repeat: it answers as
 * the first call did.
 *
 * @param {'stop' | 'start'} clock
 * @param {{ row?: any, posts?: any[], session?: any }} [state]
 * @returns {{ steps: Array<'intent' | 'post' | 'clock'>, postId: string | null }}
 */
export function clockCallSteps(clock, { row = null, posts = [], session = null } = {}) {
  const post = markedPostOf(row, posts);
  // A plan is clocked in once clockStart linked its post to a session; a plan
  // post made again (the first was deleted) is linked by clocking in again,
  // which joins the open session (reuseOpen).
  const clocked = clock === 'stop' ? session != null && session.endTime != null : post?.clockEventId != null;
  const steps = [];
  if (!row) steps.push('intent');
  if (!post) steps.push('post');
  if (!clocked) steps.push('clock');
  return { steps, postId: post ? idOf(post._id) : null };
}

/**
 * The draft's clock row when two Sends of it at once each made one (a Try
 * again while the first call still ran): the oldest, then the lowest id, so
 * both calls agree on it and the other row goes. Null when `rows` has none.
 *
 * @param {any[] | null | undefined} rows
 * @returns {any}
 */
export function firstClockRow(rows) {
  const time = (row) => new Date(row.createdAt ?? 0).getTime();
  return (
    (rows ?? [])
      .filter((row) => isClockType(row.type) && row.fallback !== 'no-clock-action')
      .sort((a, b) => time(a) - time(b) || String(a._id).localeCompare(String(b._id)))[0] ?? null
  );
}

// ─── A video that won't come ─────────────────────────────────────────────────

/**
 * The write that marks a clock row's post as missing its video when the row
 * stops (registerPulseCancelHandler's `{ row, to, reason }`): it leaves
 * `pendingVideos` and joins `missingVideos` (`at` the Send), once. Null when
 * there is nothing to mark: not a clock row with its own post (a row whose
 * clock call never ran is delivered elsewhere, §9.3), or an older attempt an
 * Edit replaced (`edited`), whose newer one is still on its way. The clock
 * record is never touched (Q1). `toPostId` turns a stored post id into the
 * database's form. A later delivery clears the mark (pulse-upload-delivery.js).
 *
 * @param {{ row: any, to: string, reason?: string }} stopped
 * @param {{ toPostId?: (id: string) => any }} [options]
 * @returns {{ filter: Record<string, any>, update: Record<string, any> } | null}
 */
export function missingVideoWrite({ row, to, reason }, { toPostId = (id) => id } = {}) {
  if (!row || !isClockType(row.type) || row.destination?.kind !== 'session-post') return null;
  if (to !== 'canceled' && to !== 'abandoned') return null;
  if (reason === 'edited') return null;
  const uploadId = row._id;
  const role = row.destination.role ?? (pulseUploadType(row.type).clock === 'stop' ? 'wrapup' : 'plan');
  const postId = row.destination.postId ?? row.postId ?? null;
  const where = postId ? { $or: [{ _id: toPostId(postId) }, { 'pendingVideos.uploadId': uploadId }] } : { 'pendingVideos.uploadId': uploadId };
  return {
    filter: { userId: row.userId, ...where, 'missingVideos.uploadId': { $ne: uploadId } },
    update: {
      $pull: { pendingVideos: { uploadId } },
      $push: { missingVideos: videoMark(uploadId, role, row.sentAt ?? row.createdAt ?? Date.now()) },
    },
  };
}

// ─── How a post shows them ───────────────────────────────────────────────────

const iso = (value) => {
  if (value == null) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/**
 * A post's `pendingVideos` or `missingVideos` as a client reads them:
 * `{ uploadId, role, at, overdueAt? }` with ISO times, nothing else stored on
 * an entry, and always an array, so a live update that empties it clears the
 * client's copy.
 *
 * @param {any} list
 * @returns {Array<{ uploadId: string, role: 'plan' | 'wrapup', at: string | null, overdueAt?: string | null }>}
 */
export function publicVideoMarks(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((mark) => mark && typeof mark.uploadId === 'string')
    .map((mark) => ({
      uploadId: mark.uploadId,
      role: mark.role === 'plan' ? 'plan' : 'wrapup',
      at: iso(mark.at),
      ...(mark.overdueAt != null ? { overdueAt: iso(mark.overdueAt) } : {}),
    }));
}
