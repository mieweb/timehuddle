/**
 * The method surface of `pulseUploads` with no Meteor or database: every
 * method's schema and rate limit, the wrapper that signs a call in and counts
 * it, the Wormhole registration, the checks on each method's arguments, the
 * queries the methods and publications run, and the shapes a row is shown in.
 * pulse-uploads.js supplies the handlers and runs the queries;
 * pulse-uploads-expose.js hands the result to Wormhole at startup.
 *
 * One table (PULSE_UPLOAD_METHODS) names every method, so a handler without
 * a schema, or a schema without a handler, fails at startup instead of being
 * a method nobody can reach over REST (Wormhole passes the body as the one
 * argument only to a method exposed with an `inputSchema`).
 */
import { createRateLimiter } from './rate-limit.js';
import { isTargetKey, normalizeTarget, pulseUploadType, targetKeyOf } from './pulse-upload-types.js';
import { PULSE_UPLOAD_STATES } from './pulse-uploads-core.js';

const MINUTE_MS = 60 * 1000;

/**
 * Calls per user per minute. Every call is a few reads and maybe a write.
 * `begin` is once per Send, plus retries; `token` comes every 2 h of an
 * upload, and once per resume; the lists are a screen opening. A person never
 * meets these, and a loop does.
 */
export const PULSE_UPLOAD_LIMITS = Object.freeze({
  begin: { limit: 120, windowMs: MINUTE_MS },
  token: { limit: 240, windowMs: MINUTE_MS },
  cancel: { limit: 120, windowMs: MINUTE_MS },
  list: { limit: 120, windowMs: MINUTE_MS },
  retarget: { limit: 30, windowMs: MINUTE_MS },
  adminList: { limit: 60, windowMs: MINUTE_MS },
  types: { limit: 60, windowMs: MINUTE_MS },
});

/** What a call beyond its limit is refused with: a Meteor.Error's `error` and `reason`. */
export const TOO_MANY_PULSE_UPLOAD_CALLS = Object.freeze({
  error: 'too-many-requests',
  reason: 'Too many Pulse upload requests at once. Try again in a moment.',
});

/** Rows still on their way: what `mine` always shows, and `forTarget` shows of a place (§6). */
export const IN_FLIGHT_STATES = Object.freeze(['intent', 'reserved', 'uploading', 'processing']);

/** How long `mine` keeps showing a video that landed: receipts live 7 days (Q5). */
export const RECENT_OUTCOME_MS = 7 * 24 * 60 * 60 * 1000;

/** Most rows one list call returns. */
export const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 50;

/** The types a kept video may be moved to (§5.5): no clock type, whose action ran only at Send. */
export const RETARGET_TYPES = Object.freeze(['ticket.video', 'clock.session', 'library.video', 'huddle.post']);

export const CANCEL_REASONS = Object.freeze(['canceled', 'edited', 'deleted']);

// ─── Schemas ─────────────────────────────────────────────────────────────────

const ID = { type: 'string', maxLength: 128 };
const STATE = { type: 'string', enum: PULSE_UPLOAD_STATES };
const TARGET = {
  type: 'object',
  description:
    'Where the video goes: {kind:"ticket", id} | {kind:"clock", id} | {kind:"clock-plan", teamId, postDate} | {kind:"huddle", teamId, conversationId?} | {kind:"library"}',
  properties: {
    kind: { type: 'string', enum: ['ticket', 'clock', 'clock-plan', 'huddle', 'library'] },
    id: ID,
    teamId: ID,
    conversationId: { type: ['string', 'null'], maxLength: 128 },
    postDate: { type: 'string', description: 'YYYY-MM-DD, for clock-plan' },
  },
  required: ['kind'],
};
const PUBLIC_UPLOAD = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    type: { type: 'string' },
    targetKey: { type: 'string' },
    state: STATE,
    name: { type: ['string', 'null'] },
    durationMs: { type: ['number', 'null'] },
    sentAt: { type: ['string', 'null'], format: 'date-time' },
    updatedAt: { type: ['string', 'null'], format: 'date-time' },
    reason: { type: ['string', 'null'] },
    note: { type: ['string', 'null'] },
    attachmentId: { type: ['string', 'null'] },
    mediaId: { type: ['string', 'null'] },
    clientKey: { type: 'string', description: 'Own rows only' },
    draftKey: { type: 'string', description: 'Own rows only' },
  },
};

const limitText = ({ limit, windowMs }) => `Limited to ${limit} calls per ${windowMs / 1000} s per user.`;

function spec(rateLimit, description, inputSchema, outputSchema) {
  return Object.freeze({
    rateLimit,
    description: `${description} ${limitText(rateLimit)}`,
    inputSchema,
    outputSchema,
  });
}

/**
 * Every pulseUploads method (huddle-server §5): its rate limit, and what
 * Wormhole documents and exposes at `POST /api/<name with . as _>`.
 */
export const PULSE_UPLOAD_METHODS = Object.freeze({
  'pulseUploads.begin': spec(
    PULSE_UPLOAD_LIMITS.begin,
    'Start (or resume) sending one Pulse video: the artifact and a 2 h PulseVault token for it. Idempotent per clientKey; one row per draftKey.',
    {
      type: 'object',
      properties: {
        clientKey: { type: 'string', maxLength: 200, description: '<installationId>:<draftId>:<16 hex>' },
        draftKey: { type: 'string', maxLength: 200, description: '<installationId>:<draftId>' },
        type: { type: 'string', description: 'The upload type id (pulseUploadTypes.list)' },
        target: TARGET,
        name: { type: ['string', 'null'] },
        sentAt: { type: 'number', description: 'ms epoch of Send, device time' },
        durationMs: { type: 'number' },
        bytes: { type: 'number' },
        renewArtifact: { type: 'boolean', description: 'PulseVault said 404 for the current artifact' },
        artifactGone: { type: 'boolean', description: 'Same as renewArtifact' },
        client: {
          type: 'object',
          properties: {
            appVersion: { type: 'string' },
            contractVersion: { type: 'string' },
            platform: { type: 'string', enum: ['ios', 'android'] },
          },
        },
      },
      required: ['clientKey', 'draftKey', 'type', 'target', 'sentAt'],
    },
    {
      type: 'object',
      properties: {
        uploadId: { type: 'string' },
        clientKey: { type: 'string' },
        artifactId: { type: 'string' },
        endpoint: { type: 'string', description: '<ROOT_URL>/pulsevault' },
        token: { type: 'string' },
        expiresAt: { type: 'number', description: 'ms epoch' },
        state: { type: 'string', enum: ['reserved', 'uploading', 'processing', 'delivered', 'kept'] },
        label: { type: 'string' },
      },
    },
  ),
  'pulseUploads.token': spec(
    PULSE_UPLOAD_LIMITS.token,
    "A fresh 2 h PulseVault token for one of the caller's uploads, for its current artifact.",
    {
      type: 'object',
      properties: { uploadId: ID, clientKey: { type: 'string', maxLength: 200 } },
      required: ['uploadId'],
    },
    { type: 'object', properties: { token: { type: 'string' }, expiresAt: { type: 'number' } } },
  ),
  'pulseUploads.cancel': spec(
    PULSE_UPLOAD_LIMITS.cancel,
    'Cancel sending one of your Pulse videos (Cancel sending, Edit, Delete). A video whose bytes are in is left as it is.',
    {
      type: 'object',
      properties: {
        uploadId: ID,
        clientKey: { type: 'string', maxLength: 200 },
        reason: { type: 'string', enum: CANCEL_REASONS },
      },
    },
    { type: 'object', properties: { state: STATE } },
  ),
  'pulseUploads.list': spec(
    PULSE_UPLOAD_LIMITS.list,
    'Your Pulse uploads, newest first.',
    {
      type: 'object',
      properties: {
        states: { type: 'array', items: STATE },
        targetKey: { type: 'string', maxLength: 128 },
        since: { type: 'number', description: 'ms epoch: rows updated since' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_LIST_LIMIT },
      },
    },
    { type: 'object', properties: { uploads: { type: 'array', items: PUBLIC_UPLOAD } } },
  ),
  'pulseUploads.retarget': spec(
    PULSE_UPLOAD_LIMITS.retarget,
    'Send a video that was kept in your library (its place was gone) somewhere else.',
    {
      type: 'object',
      properties: { uploadId: ID, type: { type: 'string', enum: RETARGET_TYPES }, target: TARGET },
      required: ['uploadId', 'type', 'target'],
    },
    { type: 'object', properties: { state: { type: 'string' }, note: { type: 'string' } } },
  ),
  'pulseUploads.adminList': spec(
    PULSE_UPLOAD_LIMITS.adminList,
    "Pulse uploads for support: your own, and those of teams you administer (team admin or org owner). With the uploader's name. teamId keeps one team's rows.",
    {
      type: 'object',
      properties: {
        teamId: ID,
        userId: ID,
        targetKey: { type: 'string', maxLength: 128 },
        clockEventId: ID,
        limit: { type: 'integer', minimum: 1, maximum: MAX_LIST_LIMIT },
      },
    },
    { type: 'object', properties: { uploads: { type: 'array', items: { type: 'object' } } } },
  ),
  'pulseUploadTypes.list': spec(
    PULSE_UPLOAD_LIMITS.types,
    "The kinds of video Pulse in the app can send for you, whether Pulse is paused for everyone (runtimePaused), and your teams' Pulse settings.",
    { type: 'object', properties: {} },
    {
      type: 'object',
      properties: {
        types: { type: 'array', items: { type: 'object' } },
        runtimePaused: { type: 'boolean' },
        teams: {
          type: 'object',
          description: '{ [teamId]: { pulseInApp, pulseClockInOut, pulseSharedDevice } }',
          additionalProperties: { type: 'object' },
        },
      },
    },
  ),
});

// ─── Registration ────────────────────────────────────────────────────────────

/** Throws unless `map` has a function for every name in `specs`, and nothing else. */
function requireSameNames(map, specs, what) {
  for (const name of Object.keys(specs)) {
    if (typeof map[name] !== 'function') throw new Error(`[pulse-uploads] ${what} for ${name} is missing`);
  }
  for (const name of Object.keys(map)) {
    if (!Object.hasOwn(specs, name)) throw new Error(`[pulse-uploads] ${name} has no schema or rate limit`);
  }
}

/**
 * The Meteor methods for `handlers` (`{ [name]: (identity, args, invocation) => result }`):
 * each signs the call in (`requireIdentity(this)`), counts it against the
 * method's own limit for that user, and only then runs the handler, with
 * `args` an object even when the call sent none. `tooManyRequests(retryAfterMs)`
 * makes the error a refused call throws. `now` is for tests.
 */
export function pulseUploadMethods(
  handlers,
  { requireIdentity, tooManyRequests, specs = PULSE_UPLOAD_METHODS, now = Date.now },
) {
  requireSameNames(handlers, specs, 'A handler');
  return Object.fromEntries(
    Object.entries(specs).map(([name, { rateLimit }]) => {
      const limiter = createRateLimiter({ ...rateLimit, now });
      const handler = handlers[name];
      const method = async function (args) {
        const identity = await requireIdentity(this);
        const { allowed, retryAfterMs } = limiter.check(identity.userId);
        if (!allowed) throw tooManyRequests(retryAfterMs);
        return handler(identity, args && typeof args === 'object' ? args : {}, this);
      };
      return [name, method];
    }),
  );
}

/**
 * Expose every method in `specs` through `wormhole` (`Wormhole.expose`), with
 * its description (which states its rate limit) and schemas. `methods` is the
 * Meteor method map (pulseUploadMethods); it must name the same methods, so
 * nothing is exposed that isn't defined, or defined but unreachable over REST.
 * Returns the exposed names.
 */
export function exposePulseUploads(wormhole, methods, specs = PULSE_UPLOAD_METHODS) {
  requireSameNames(methods, specs, 'A method');
  for (const [name, { description, inputSchema, outputSchema }] of Object.entries(specs)) {
    wormhole.expose(name, { description, inputSchema, outputSchema });
  }
  return Object.keys(specs);
}

// ─── Arguments ───────────────────────────────────────────────────────────────

const badRequest = (reason) => ({ error: 'bad-request', reason });
const isNonEmptyString = (value, max = 128) => typeof value === 'string' && value.length > 0 && value.length <= max;
const isTime = (value) => typeof value === 'number' && Number.isFinite(value);

function checkLimit(limit) {
  if (limit == null) return { value: DEFAULT_LIST_LIMIT };
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    return badRequest(`limit must be 1–${MAX_LIST_LIMIT}`);
  }
  return { value: limit };
}

/** `pulseUploads.token`'s arguments: `{ value: { uploadId, clientKey } }` or a refusal. */
export function checkTokenArgs(args) {
  if (!isNonEmptyString(args?.uploadId)) return badRequest('uploadId is required');
  if (args.clientKey != null && !isNonEmptyString(args.clientKey, 200)) return badRequest('Invalid clientKey');
  return { value: { uploadId: args.uploadId, clientKey: args.clientKey ?? null } };
}

/**
 * `pulseUploads.cancel`'s arguments: the row named by `uploadId` or, without
 * one, by `clientKey`, and why (`canceled` by default).
 */
export function checkCancelArgs(args) {
  const uploadId = args?.uploadId ?? null;
  const clientKey = args?.clientKey ?? null;
  if (uploadId != null && !isNonEmptyString(uploadId)) return badRequest('Invalid uploadId');
  if (clientKey != null && !isNonEmptyString(clientKey, 200)) return badRequest('Invalid clientKey');
  if (uploadId == null && clientKey == null) return badRequest('uploadId or clientKey is required');
  const reason = args.reason ?? 'canceled';
  if (!CANCEL_REASONS.includes(reason)) return badRequest('Invalid reason');
  return { value: { uploadId, clientKey, reason } };
}

/**
 * `pulseUploads.list`'s arguments as the query for `userId`'s rows:
 * `{ value: { query, limit } }`, newest first by `updatedAt`.
 */
export function checkListArgs(userId, args = {}) {
  const query = { userId };
  if (args.states != null) {
    if (!Array.isArray(args.states) || !args.states.every((state) => PULSE_UPLOAD_STATES.includes(state))) {
      return badRequest('Invalid states');
    }
    query.state = { $in: [...new Set(args.states)] };
  }
  if (args.targetKey != null) {
    if (!isTargetKey(args.targetKey)) return badRequest('Invalid targetKey');
    query.targetKey = args.targetKey;
  }
  if (args.since != null) {
    if (!isTime(args.since)) return badRequest('Invalid since');
    query.updatedAt = { $gte: new Date(args.since) };
  }
  const limit = checkLimit(args.limit);
  if (limit.error) return limit;
  return { value: { query, limit: limit.value } };
}

/**
 * `pulseUploads.retarget`'s arguments for `userId`: `{ value: { uploadId,
 * type, target, targetKey } }`, the target normalised, or a refusal.
 */
export function checkRetargetArgs(userId, args) {
  if (!isNonEmptyString(args?.uploadId)) return badRequest('uploadId is required');
  if (!RETARGET_TYPES.includes(args.type)) return badRequest('A kept video can go to a ticket, a session, a post or your library');
  const target = normalizeTarget(args.type, args.target);
  const targetKey = target && targetKeyOf(args.type, target, userId);
  if (!targetKey) return badRequest('Invalid target for this upload type');
  return { value: { uploadId: args.uploadId, type: args.type, target, targetKey } };
}

/**
 * `pulseUploads.adminList`'s arguments as a query on top of what the caller
 * may see: `{ value: { query, limit } }`, or a refusal.
 */
export function checkAdminListArgs(args = {}) {
  const query = {};
  // One team's rows (stored as the team's string id), so a page of `limit`
  // isn't spent on the caller's other teams.
  if (args.teamId != null) {
    if (!isNonEmptyString(args.teamId)) return badRequest('Invalid teamId');
    query.teamId = args.teamId;
  }
  if (args.userId != null) {
    if (!isNonEmptyString(args.userId)) return badRequest('Invalid userId');
    query.userId = args.userId;
  }
  if (args.targetKey != null) {
    if (!isTargetKey(args.targetKey)) return badRequest('Invalid targetKey');
    query.targetKey = args.targetKey;
  }
  if (args.clockEventId != null) {
    if (!isNonEmptyString(args.clockEventId)) return badRequest('Invalid clockEventId');
    query.clockEventId = args.clockEventId.toLowerCase();
  }
  const limit = checkLimit(args.limit);
  if (limit.error) return limit;
  return { value: { query, limit: limit.value } };
}

/**
 * The rows `pulseUploads.adminList` may show the caller: their own, and
 * those of the teams they administer (`adminTeamIds`: team admin, or owner
 * of the team's org).
 */
export function adminScopeQuery(callerId, adminTeamIds) {
  return { $or: [{ userId: callerId }, ...(adminTeamIds.length ? [{ teamId: { $in: adminTeamIds } }] : [])] };
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/** `pulseUploads.mine`: the caller's rows on their way, and those that landed in the last 7 days. */
export function mineQuery(userId, now) {
  return {
    userId,
    $or: [
      { state: { $in: [...IN_FLIGHT_STATES] } },
      { state: { $in: ['delivered', 'kept'] }, updatedAt: { $gte: new Date(now - RECENT_OUTCOME_MS) } },
    ],
  };
}

/**
 * Whose rows `pulseUploads.forTarget(targetKey)` may show, before the
 * caller's access is checked: `{ check: 'ticket', id }` (the ticket's team
 * sees everyone's), `{ check: 'clock', id }` (the session's owner and its
 * team's admins see it), or `{ check: 'own' }` (only the caller's own rows).
 * A Huddle key is own-only: one key holds every conversation of the team,
 * and a direct conversation's pending video must not reach the whole team
 * (#871 R21). Null for a key that isn't one.
 */
export function forTargetScope(targetKey) {
  if (!isTargetKey(targetKey)) return null;
  const [kind, id] = targetKey.split(':');
  if (kind === 'ticket' || kind === 'clock') return { check: kind, id };
  return { check: 'own' };
}

/**
 * The rows `forTarget` publishes: on that key, on their way with an artifact (§6).
 * @param {string} targetKey
 * @param {string | null} [ownerId] only this person's rows
 */
export function forTargetQuery(targetKey, ownerId = null) {
  return {
    targetKey,
    state: { $in: ['reserved', 'uploading', 'processing'] },
    ...(ownerId ? { userId: ownerId } : {}),
  };
}

/**
 * The clock session a video sent at `at` (ms) belongs to (H4): with rule
 * `at-begin` (sendContextRule) the one open now, as huddle.js's
 * openSessionId finds it; with `as-of-sent` the one whose interval holds
 * `at`, never a later one (Q9). Clock times are ms numbers. Sort newest first.
 */
export function sessionAtSendQuery(userId, teamId, at, rule) {
  if (rule === 'at-begin') return { userId, teamId, endTime: null };
  return { userId, teamId, startTime: { $lte: at }, $or: [{ endTime: null }, { endTime: { $gt: at } }] };
}

// ─── Shapes ──────────────────────────────────────────────────────────────────

/** The fields the publications send (`_id` always goes): PulseUploadPublic, plus the keys on own rows. */
export const PUBLIC_UPLOAD_FIELDS = Object.freeze({
  userId: 1,
  type: 1,
  targetKey: 1,
  state: 1,
  name: 1,
  durationMs: 1,
  sentAt: 1,
  updatedAt: 1,
  reason: 1,
  note: 1,
  attachmentId: 1,
  mediaId: 1,
});
export const OWN_UPLOAD_FIELDS = Object.freeze({ ...PUBLIC_UPLOAD_FIELDS, clientKey: 1, draftKey: 1 });

const iso = (value) => (value == null ? null : new Date(value).toISOString());

/** A row as `list` returns it (PulseUploadPublic, §15); `own` adds its keys. */
export function publicUpload(row, { own = false } = {}) {
  return {
    id: row._id,
    userId: row.userId,
    type: row.type,
    targetKey: row.targetKey,
    state: row.state,
    name: row.name ?? null,
    durationMs: row.durationMs ?? null,
    sentAt: iso(row.sentAt),
    updatedAt: iso(row.updatedAt),
    reason: row.reason ?? null,
    note: row.note ?? null,
    attachmentId: row.attachmentId ?? null,
    mediaId: row.mediaId ?? null,
    ...(own ? { clientKey: row.clientKey ?? null, draftKey: row.draftKey ?? null } : {}),
  };
}

const ADMIN_DATES = ['sentAt', 'createdAt', 'updatedAt', 'deliveredAt', 'tokenIssuedAt', 'overdueAt'];

/**
 * A row as `adminList` returns it: every field (no token is stored), dates as ISO, and who sent it.
 * @param {Record<string, any>} row
 * @param {string | null} [userName]
 */
export function adminUpload(row, userName = null) {
  const { _id, ...fields } = row;
  const dates = Object.fromEntries(ADMIN_DATES.filter((key) => key in row).map((key) => [key, iso(row[key])]));
  return { id: _id, ...fields, ...dates, userName };
}

/** What a type is called when nothing names the place: its title. */
export function plainLabelOf(typeId) {
  return pulseUploadType(typeId)?.title ?? 'Pulse video';
}
