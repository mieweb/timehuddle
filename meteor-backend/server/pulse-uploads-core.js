/**
 * The rules of `pulseUploads`, the server's record of each video Pulse in the
 * app sends, with no Meteor or database: what a `begin` does with the rows a
 * draft already has, which state an event moves a row to, which PulseVault
 * events touch a row at all, when a row is overdue, and how a refusal reads
 * to Pulse. pulse-uploads.js runs them against the collection.
 *
 * Two keys name a video (PLAN AD32):
 *  - `draftKey` = `<installationId>:<draftId>`, one draft on one phone. It
 *    survives Edit and Move to…, so a draft has one row, found by it: a clock
 *    call at Send makes the row (`intent`) and the begin that follows takes it
 *    over, whatever clientKey that Send ended up with.
 *  - `clientKey` = `<draftKey>:<16 hex>`, one export of that draft. A begin
 *    with the same one is a retry and gets the same artifact; a new one
 *    (after an Edit) replaces the row's artifact and retires the old key
 *    (`replacedClientKeys`), so a late begin, cancel or token call for the
 *    older export changes nothing while the newer one is under way. Once
 *    nothing is, the older key is a new Send again (an Edit undone).
 *
 * One row per draftKey, whose clientKey moves to each new export. The
 * contract (huddle-server §3.2) has a row per clientKey, with the newer
 * cancelling the older; the draft's row here is the same record without the
 * extra rows, and `replacedClientKeys` keeps the older exports from acting.
 *
 * A Move to… keeps the clientKey when nothing was edited (Pulse builds it
 * from the clips alone), so the same clientKey naming another place is a
 * move, not the contract's §5.1 `conflict`: the row goes to the new place,
 * checked first. It stays a conflict once the bytes are in, or when the
 * row's clock action ran (O13).
 *
 * Time never abandons a row (O14): 24 h after Send it is only overdue, and a
 * video that arrives later still attaches. A row is abandoned when its draft
 * is deleted or PulseVault drops its unfinished upload.
 */
import {
  isClockType,
  normalizeTarget,
  PULSE_MAX_UPLOAD_BYTES,
  pulseUploadType,
  targetKeyOf,
} from './pulse-upload-types.js';

export {
  PULSE_MAX_UPLOAD_BYTES,
  PULSE_UPLOAD_TYPES,
  PULSE_UPLOAD_TYPE_IDS,
  destinationRequestOf,
  isClockType,
  isTargetKey,
  normalizeTarget,
  pulseUploadType,
  pulseUploadTypeInfo,
  targetKeyOf,
} from './pulse-upload-types.js';

export const PULSE_UPLOAD_STATES = Object.freeze([
  'intent', // a clock call at Send made the row; no artifact yet (clock.wrapup / clock.plan)
  'reserved', // begin minted an artifact and a token; no bytes yet
  'uploading', // PulseVault authorized the video's upload
  'processing', // the video's bytes landed; delivery follows
  'delivered', // delivered where it was sent
  'kept', // the place was gone at delivery; the video is in the uploader's library
  'canceled', // Cancel sending or an Edit; a begin restarts it
  'failed', // a refusal recorded for support
  'abandoned', // the draft was deleted, or PulseVault removed the unfinished upload
]);

/** Rows that can still be cancelled: nothing of the video has landed. */
const CANCELLABLE = new Set(['intent', 'reserved', 'uploading']);

/** Rows with an outcome Pulse retires the draft on. */
const OUTCOME = new Set(['delivered', 'kept']);

/** Rows a begin starts again, with a new artifact. */
const RESTARTABLE = new Set(['canceled', 'abandoned', 'failed']);

/** Rows with an artifact attempt under way, whose bytes haven't landed. */
const LIVE_ATTEMPT = new Set(['reserved', 'uploading']);

/** Rows that refuse every PulseVault request made under their token. */
const REFUSES_UPLOADS = new Set(['canceled', 'abandoned']);

// ─── Keys ────────────────────────────────────────────────────────────────────

/** Longest clientKey the server stores. */
export const MAX_CLIENT_KEY_LENGTH = 200;

const KEY_PART = '[A-Za-z0-9._-]{1,80}';
const DRAFT_KEY_RE = new RegExp(`^${KEY_PART}:${KEY_PART}$`);
const CLIENT_KEY_RE = new RegExp(`^(${KEY_PART}:${KEY_PART}):[0-9a-f]{16}$`, 'i');

/** Whether `key` is a draftKey: `<installationId>:<draftId>`. */
export function isDraftKey(key) {
  return typeof key === 'string' && DRAFT_KEY_RE.test(key);
}

/** Whether `key` is a clientKey: `<installationId>:<draftId>:<16 hex>`, at most 200 characters. */
export function isClientKey(key) {
  return typeof key === 'string' && key.length <= MAX_CLIENT_KEY_LENGTH && CLIENT_KEY_RE.test(key);
}

/** The draftKey a clientKey belongs to, or null for a key that isn't one. */
export function draftKeyOf(clientKey) {
  return isClientKey(clientKey) ? CLIENT_KEY_RE.exec(clientKey)[1] : null;
}

// ─── Time ────────────────────────────────────────────────────────────────────

/** How far back a Send may be: receipts are kept 7 days (Q5). */
export const MAX_SEND_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * When a video was sent, as the server files it: the phone's `sentAt` (ms),
 * held to the last 7 days. Any time in the future reads as `now`: a phone a
 * few seconds fast and one hours fast both get the server's time, so there is
 * no separate "30 s ahead" bound to keep. Not a number: `now`. The worst a
 * wrong clock can do is file a video into another workday of the same team,
 * and this bounds it.
 */
export function sendTime(sentAt, now) {
  if (typeof sentAt !== 'number' || !Number.isFinite(sentAt) || sentAt > now) return now;
  return Math.max(sentAt, now - MAX_SEND_AGE_MS);
}

/** How long after Send a begin still finds the session and conversation as they are now. */
export const SEND_CONTEXT_WINDOW_MS = 5 * 60 * 1000;

/**
 * Where a begin finds the session (and, after #871, the conversation) a video
 * was sent in (H4). Within 5 minutes of Send, the normal online case, nothing
 * has had time to change: `'at-begin'`, the open session now. Later (the
 * phone was offline), `'as-of-sent'`: the session whose interval holds
 * `sentAt`, never a later one (Q9). Both times in ms; `sentAt` as sendTime
 * returns it.
 */
export function sendContextRule(sentAt, beginAt) {
  return beginAt - sentAt <= SEND_CONTEXT_WINDOW_MS ? 'at-begin' : 'as-of-sent';
}

// ─── Begin ───────────────────────────────────────────────────────────────────

/** The refusals begin and the clock calls answer with: a Meteor.Error's `error` and `reason`. */
export const PULSE_UPLOAD_REFUSALS = Object.freeze({
  tooLarge: {
    error: 'too-large',
    reason: `Too large to send to TimeHuddle (max ${PULSE_MAX_UPLOAD_BYTES / (1024 * 1024)} MB)`,
  },
  otherTarget: { error: 'conflict', reason: 'That video is already being sent somewhere else' },
  clockBound: { error: 'conflict', reason: 'That video belongs to its clock action' },
  uploaded: { error: 'conflict', reason: 'That video has already been uploaded' },
  superseded: { error: 'conflict', reason: 'A newer send of that video replaced this one' },
  sentWithoutClock: { error: 'conflict', reason: 'That video is already being sent without its clock action' },
});

/** Whether `row` retired `clientKey`: an Edit's newer clientKey took the row from it. */
const retiredKey = (row, clientKey) => (row.replacedClientKeys ?? []).includes(clientKey);

/**
 * Whether a cancel or token call naming `clientKey` is about an attempt
 * `row` has moved past, so it must change nothing: a key the row retired
 * (`replacedClientKeys`), or, once the row has adopted one, any key but its
 * own. A late release of the pre-Edit export lands here, since every attempt
 * of a draft shares one uploadId. An `intent` row takes any key it hasn't
 * retired (the next begin adopts it), and a call with no `clientKey` (by
 * uploadId alone) is never stale.
 */
export function isStaleAttempt(row, clientKey) {
  if (!row || clientKey == null) return false;
  // A key the row took back (an Edit undone) is its own again.
  if (row.clientKey != null && row.clientKey === clientKey) return false;
  if (retiredKey(row, clientKey)) return true;
  return row.state !== 'intent' && row.clientKey != null && row.clientKey !== clientKey;
}

/**
 * Whether a row and a begin's arguments name the same place: the same type
 * and key and, for a key that groups several places (huddle.post's
 * `huddle:<teamId>` holds every conversation of the team, Q14), the same
 * normalised target too. A stored target that no longer normalises is
 * matched by key alone.
 */
function samePlace(row, args) {
  if (row.type !== args.type || row.targetKey !== args.targetKey) return false;
  const stored = row.target == null ? null : normalizeTarget(row.type, row.target);
  if (!stored || !args.target) return true;
  return placeSignature(stored) === placeSignature(args.target);
}

const placeSignature = (target) =>
  JSON.stringify(
    Object.keys(target)
      .sort()
      .map((key) => [key, target[key]]),
  );

const badRequest = (reason) => ({ error: 'bad-request', reason });

const isCount = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/**
 * The refusal for a video of `bytes` sent as `type`, or null when it fits.
 * Checked before anything is written or clocked (O15); an unknown size passes,
 * and PulseVault's own cap still applies to the upload.
 */
export function uploadSizeRefusal(typeId, bytes) {
  const max = pulseUploadType(typeId)?.maxBytes ?? PULSE_MAX_UPLOAD_BYTES;
  return isCount(bytes) && bytes > max ? PULSE_UPLOAD_REFUSALS.tooLarge : null;
}

/**
 * `pulseUploads.begin`'s arguments checked and normalised for `userId` at
 * `now` (ms): `{ value }` or a refusal `{ error: 'bad-request', reason }`.
 * `value.sentAt` is sendTime's; `renew` is `renewArtifact` or `artifactGone`
 * (PulseVault said 404 for the current artifact). `name` is passed on as
 * given, for cleanVideoName.
 */
export function checkBeginArgs(userId, args, now) {
  if (!args || typeof args !== 'object') return badRequest('Missing arguments');
  const { clientKey, draftKey, type, target, sentAt, bytes, durationMs, name, client } = args;
  if (!isClientKey(clientKey)) return badRequest('Invalid clientKey');
  if (!isDraftKey(draftKey) || draftKeyOf(clientKey) !== draftKey) return badRequest('Invalid draftKey');
  if (!pulseUploadType(type)) return badRequest('Unknown upload type');
  const normalized = normalizeTarget(type, target);
  const targetKey = normalized && targetKeyOf(type, normalized, userId);
  if (!targetKey) return badRequest('Invalid target for this upload type');
  if (typeof sentAt !== 'number' || !Number.isFinite(sentAt)) return badRequest('Invalid sentAt');
  if (bytes != null && !isCount(bytes)) return badRequest('Invalid bytes');
  if (durationMs != null && !isCount(durationMs)) return badRequest('Invalid durationMs');
  if (name != null && typeof name !== 'string') return badRequest('Invalid name');
  for (const flag of ['renewArtifact', 'artifactGone']) {
    if (args[flag] != null && typeof args[flag] !== 'boolean') return badRequest(`Invalid ${flag}`);
  }
  return {
    value: {
      clientKey,
      draftKey,
      type,
      target: normalized,
      targetKey,
      sentAt: sendTime(sentAt, now),
      bytes: bytes ?? null,
      durationMs: durationMs ?? null,
      name: name ?? null,
      renew: args.renewArtifact === true || args.artifactGone === true,
      client: clientFacts(client),
    },
  };
}

/** What a client says about itself, for support: short strings, a known platform, or null. */
function clientFacts(client) {
  const text = (value, max) => (typeof value === 'string' && value.length <= max ? value : null);
  return {
    appVersion: text(client?.appVersion, 64),
    contractVersion: text(client?.contractVersion, 16),
    platform: client?.platform === 'ios' || client?.platform === 'android' ? client.platform : null,
  };
}

/** A stored time (Date or ms) in ms, or null. */
const timeMs = (value) => (value == null ? null : new Date(value).getTime());

/** A row's time for ordering: its last change. */
const timeOf = (row) => new Date(row.updatedAt ?? row.createdAt ?? 0).getTime();
const newestOf = (rows) => rows.reduce((newest, row) => (!newest || timeOf(row) > timeOf(newest) ? row : newest), null);

/** Whether a row's clock action ran at Send, so its video can't go anywhere else (O13). */
function isClockBound(row) {
  return isClockType(row.type) && row.fallback !== 'no-clock-action';
}

/**
 * What `pulseUploads.begin` does, from the caller's rows with this draftKey
 * (`rows`, any state) and checkBeginArgs's `value` (`args`). Nothing here
 * writes; the caller writes what the decision says, in this order:
 *
 *  - `error`, `reason`: refuse with these and write nothing (`action` is
 *    `refuse` for a too-large video, `conflict` for a key used elsewhere).
 *  - `resolveTarget`: run `deliverAs`'s destination check first
 *    (destinationRequestOf); a not-found or forbidden refuses, nothing written.
 *  - `action`:
 *     - `insert`: a new row (`state` reserved, a new artifact).
 *     - `reuse`: a retry; the same artifact, a fresh token.
 *     - `renew`: the artifact is gone at PulseVault; a new one.
 *     - `reissue`: a new artifact for the draft's row, after a cancel, an
 *       abandon or a refusal, or for an Edit's new clientKey. A Move to…
 *       (another type or target) also lands here, with `resolveTarget`,
 *       whether or not its clientKey is new: Pulse builds the clientKey
 *       from the clips alone (pulse-schema §3.1), so a Move to… with no Edit
 *       sends the same one with the new place.
 *     - `adoptIntent`: the clock call's row takes this clientKey and an artifact.
 *     - `returnOutcome`: the video already landed; the reply carries its
 *       state, and Pulse retires the draft.
 *  - `mintArtifact`: a new artifactId for the row; `retireArtifactId` (if
 *    any) moves to `replacedArtifactIds` and is removed from PulseVault.
 *  - `retireClientKey`: the row's clientKey this begin replaces (an Edit's
 *    new export), pushed to `replacedClientKeys`. A later begin, cancel or
 *    token call naming it changes nothing (isStaleAttempt): the row keeps one
 *    current attempt, so a delayed call for an older one can't undo a newer.
 *    A retired clientKey is refused while the row's attempt is under way
 *    (reserved, uploading); once nothing is (cancelled, refused, abandoned),
 *    it is a new Send, as after an Edit that was undone: the row takes it
 *    back (`reviveClientKey`, pulled from `replacedClientKeys`) and retires
 *    the one it had.
 *  - For every action but `reuse` and `returnOutcome`, the row takes `args`'
 *    clientKey, type, target and targetKey, `state`, `sentAt` and `fallback`.
 *    `resolveSendContext`: `sentAt` is new, so the session (and conversation)
 *    at Send are found again (sendContextRule). A row that isn't clock-bound
 *    and restarts with the same clientKey takes the begin's `sentAt` when it
 *    differs (a Send after Cancel sending is a new job); a clock-bound row
 *    keeps its clock action's (O13).
 *  - `cancel`: older attempts of this draft still under way, to cancel with
 *    `reason: 'edited'`.
 *
 * A video that landed answers with its outcome whatever place the begin
 * names: after a `retarget` the row's place is the new one, and a resend
 * after a kill still names the first.
 *
 * @param {object[]} rows
 * @param {object} args
 * @returns {BeginDecision}
 */
export function beginDecision(rows, args) {
  const tooLarge = uploadSizeRefusal(args.type, args.bytes);
  if (tooLarge) return refusal('refuse', tooLarge);

  const sameKey = rows.find((row) => row.clientKey === args.clientKey) ?? null;
  // The row this begin acts on: a video that landed wins (a draft is sent
  // once, Q15), then this very attempt, then the draft's latest one under way.
  const current =
    rows.find((row) => OUTCOME.has(row.state)) ??
    sameKey ??
    newestOf(rows.filter((row) => !RESTARTABLE.has(row.state))) ??
    newestOf(rows);
  // Other artifact attempts of this draft still under way. Never another
  // intent: cancelling one would flag its post as missing a video.
  const cancel = rows
    .filter((row) => row !== current && (row.state === 'reserved' || row.state === 'uploading'))
    .map((row) => ({ _id: row._id, reason: 'edited' }));

  if (!current) {
    return decision('insert', null, args, {
      cancel,
      sentAt: args.sentAt,
      resolveTarget: true,
      resolveSendContext: true,
      ...freshSend(args.type),
    });
  }

  if (OUTCOME.has(current.state)) return decision('returnOutcome', current, args, { cancel });

  // A late or replayed begin of an export an Edit replaced, while the newer
  // export is under way: never turn the row back to it, which would retire
  // the newer export's artifact. With nothing under way (cancelled, refused,
  // abandoned) the same clientKey is a new Send: undoing the Edit gives the
  // older clips, and so the older clientKey, back (pulse-schema §3.1). It
  // goes on below as any new clientKey does, and takes the key back.
  if (!sameKey && rows.some((row) => retiredKey(row, args.clientKey) && LIVE_ATTEMPT.has(row.state))) {
    return refusal('conflict', PULSE_UPLOAD_REFUSALS.superseded);
  }

  // Everything about the row stays but its artifact.
  const kept = { cancel, sentAt: current.sentAt, deliverAs: deliverAsOf(current), fallback: current.fallback ?? null };
  // Cancel sending ends the job; Pulse's next Send is a new job with its
  // own time (pulse-schema §3), so a restarted row takes it, and finds the
  // session (and conversation) at that Send again (H4). A Retry of a refused
  // job sends its first time back, which changes nothing. A clock-bound row
  // keeps its clock action's time (O13).
  const resent =
    !isClockBound(current) && args.sentAt !== timeMs(current.sentAt)
      ? { sentAt: args.sentAt, resolveSendContext: true }
      : {};
  const moved = !samePlace(current, args);
  if (isClockBound(current)) {
    // Its clock action ran for that place: the video can't go anywhere else (O13).
    if (moved) return refusal('conflict', PULSE_UPLOAD_REFUSALS.clockBound);
    // Adopted whatever clientKey the Send ended with (AD32). An Edit keeps
    // the clock action's time (O13).
    if (current.state === 'intent') return decision('adoptIntent', current, args, kept);
  }

  // A Send of its own to a new place: its time, its place checked, and the
  // clock rule of a row with none (freshSend).
  const moveTo = (extra = {}) =>
    decision('reissue', current, args, {
      cancel,
      sentAt: args.sentAt,
      resolveTarget: true,
      resolveSendContext: true,
      moved: true,
      ...freshSend(args.type),
      ...extra,
    });

  if (current.clientKey === args.clientKey) {
    // A Move to… with no Edit: the same clientKey names the new place. Once
    // the bytes are in, the video is going to the old one.
    if (moved) {
      if (current.state === 'processing') return refusal('conflict', PULSE_UPLOAD_REFUSALS.otherTarget);
      return moveTo();
    }
    if (RESTARTABLE.has(current.state)) {
      // A refusal is checked again: the place may be back. A clock row's
      // place is its post, made at Send.
      const recheck = current.state === 'failed' && !isClockBound(current);
      return decision('reissue', current, args, { ...kept, ...resent, resolveTarget: recheck });
    }
    if (args.renew && current.state !== 'processing') return decision('renew', current, args, kept);
    return decision('reuse', current, args, kept);
  }

  // A new clientKey for this draft: an Edit, or a Move to….
  if (current.state === 'processing') return refusal('conflict', PULSE_UPLOAD_REFUSALS.uploaded);
  if (isClockBound(current)) return decision('reissue', current, args, kept);
  if (moved) return moveTo();
  // An Edit in place: a Send of its own, and a refused place checked again.
  return decision('reissue', current, args, {
    cancel,
    sentAt: args.sentAt,
    resolveTarget: current.state === 'failed',
    resolveSendContext: true,
    deliverAs: deliverAsOf(current),
    fallback: current.fallback ?? null,
  });
}

/**
 * How a Send to `type` with no clock action of its own is delivered: as
 * itself, or, for a clock type, as its fallback type and flagged (§9.3).
 * A clock type's action runs only at Send (intentDecision); a begin that
 * finds no clock-bound row for it never ran one, whether the draft had no
 * row or was moved onto the clock type.
 */
function freshSend(type) {
  const clock = isClockType(type);
  return {
    deliverAs: clock ? pulseUploadType(type).fallbackType : type,
    fallback: clock ? 'no-clock-action' : null,
  };
}

/**
 * @typedef {object} BeginDecision
 * @property {'insert' | 'reuse' | 'renew' | 'reissue' | 'adoptIntent' | 'returnOutcome' | 'refuse' | 'conflict'} action
 * @property {string} [error] a refusal's Meteor.Error `error`
 * @property {string} [reason] and its `reason`
 * @property {any} [row] the row acted on; null for an insert
 * @property {string | null} [state]
 * @property {boolean} [mintArtifact]
 * @property {string | null} [retireArtifactId]
 * @property {string | null} [retireClientKey]
 * @property {string | null} [reviveClientKey]
 * @property {boolean} [resolveTarget]
 * @property {boolean} [resolveSendContext]
 * @property {any} [sentAt] ms for a new Send, else the row's own
 * @property {string} [deliverAs]
 * @property {'no-clock-action' | null} [fallback]
 * @property {Array<{ _id: any, reason: 'edited' }>} [cancel]
 */

/** The type a row delivers as: its fallback when its clock call never ran. */
function deliverAsOf(row) {
  return row.fallback === 'no-clock-action' ? (pulseUploadType(row.type)?.fallbackType ?? row.type) : row.type;
}

function refusal(action, { error, reason }) {
  return { action, error, reason };
}

function decision(
  action,
  row,
  args,
  { cancel, sentAt, resolveTarget = false, resolveSendContext = false, moved = false, deliverAs, fallback = null },
) {
  const replaces = action === 'reissue' || action === 'renew';
  const takesKey = action !== 'reuse' && action !== 'returnOutcome';
  const event = {
    type: 'begin',
    edited: !!row && row.clientKey !== args.clientKey,
    renew: action === 'renew',
    moved,
  };
  return {
    action,
    row,
    state: nextState(row, event),
    mintArtifact: takesKey,
    retireArtifactId: replaces ? (row.artifactId ?? null) : null,
    retireClientKey: takesKey && row?.clientKey != null && row.clientKey !== args.clientKey ? row.clientKey : null,
    reviveClientKey: takesKey && row && retiredKey(row, args.clientKey) ? args.clientKey : null,
    resolveTarget,
    resolveSendContext,
    sentAt: sentAt ?? row?.sentAt ?? null,
    deliverAs: deliverAs ?? row?.type ?? args.type,
    fallback,
    cancel,
  };
}

/**
 * What a clock call at Send (clock.stopWithVideo / clock.startWithPlan) does
 * with the caller's rows for its draftKey: `insert` an intent row,
 * `repeat` (the call already ran for this draft: return its first answer and
 * change nothing), or a refusal: a type with no clock action (`bad-request`),
 * too large (before any clock action, O15), a draft already sent somewhere
 * else, or one a begin already sent without its clock action (its Send-time
 * call never got through, so the video goes as the fallback type; `repeat`
 * there would tell the caller a clock action ran that never did).
 */
export function intentDecision(rows, { type, targetKey, bytes }) {
  if (!isClockType(type)) return badRefusal('Not a clock upload type');
  const tooLarge = uploadSizeRefusal(type, bytes);
  if (tooLarge) return refusal('refuse', tooLarge);
  const row = rows.find((r) => isClockBound(r)) ?? newestOf(rows);
  if (!row) return { action: 'insert', state: nextState(null, { type: 'intent' }) };
  if (row.type !== type || row.targetKey !== targetKey) return refusal('conflict', PULSE_UPLOAD_REFUSALS.otherTarget);
  if (!isClockBound(row)) return refusal('conflict', PULSE_UPLOAD_REFUSALS.sentWithoutClock);
  return { action: 'repeat', row };
}

function badRefusal(reason) {
  return { action: 'refuse', ...badRequest(reason) };
}

/**
 * What `pulseUploads.token` does for `row` (the caller's, found by
 * uploadId) and the `clientKey` the call names, if any: `{ action: 'mint' }`
 * for the row's current artifact, or `conflict` for a row that refuses
 * uploads (canceled, abandoned; §5.2), one with no artifact yet (an intent, a
 * refusal), or a clientKey the row moved past (isStaleAttempt), whose token
 * would be for an artifact that isn't that export's.
 */
export function tokenDecision(row, { clientKey } = {}) {
  if (isStaleAttempt(row, clientKey)) return refusal('conflict', PULSE_UPLOAD_REFUSALS.superseded);
  if (REFUSES_UPLOADS.has(row.state) || !row.artifactId) {
    return refusal('conflict', { error: 'conflict', reason: 'That upload is no longer open' });
  }
  return { action: 'mint' };
}

// ─── States ──────────────────────────────────────────────────────────────────

/**
 * The state `row` moves to on `event`, or null when the event doesn't apply
 * to it (the caller refuses it with `conflict`, or a hook ignores it). The
 * same state back means "unchanged": a replay. `row` null is no row yet.
 *
 * Events:
 *  - `intent`: a clock call at Send.
 *  - `begin` (`edited`: a new clientKey for the draft; `renew`: a new
 *    artifact; `moved`: a Move to… another place, a new artifact too).
 *  - `authorize`: PulseVault authorized the video's upload.
 *  - `complete`: the video's bytes landed.
 *  - `deliver` (`outcome: 'done' | 'kept'`): onUploadComplete's delivery.
 *  - `cancel` (`reason: 'canceled' | 'edited' | 'deleted'`; `clientKey`, when
 *    the call names one: a stale one, isStaleAttempt, leaves the row as it is).
 *  - `artifactAbandoned`: PulseVault removed the unfinished upload.
 *  - `retarget`: a kept video delivered somewhere else.
 *  - `refused`: a begin-time refusal recorded for support.
 * There is no event for time passing: the sweep marks rows overdue, never
 * abandoned (O14).
 */
export function nextState(row, event) {
  const from = row?.state ?? null;
  switch (event?.type) {
    case 'intent':
      // The clock call is idempotent per draftKey: a repeat changes nothing.
      return from ?? 'intent';
    case 'begin':
      if (from === null || from === 'intent' || RESTARTABLE.has(from)) return 'reserved';
      if (from === 'reserved' || from === 'uploading') {
        return event.renew || event.edited || event.moved ? 'reserved' : from;
      }
      // The bytes are in: an Edit or a Move to… can't replace them.
      if (from === 'processing') return event.edited || event.moved ? null : from;
      return OUTCOME.has(from) ? from : null;
    case 'authorize':
      return from === 'reserved' || from === 'uploading' ? 'uploading' : null;
    case 'complete':
      // From reserved too: the bytes landed, whether or not the authorize was recorded.
      return from === 'reserved' || from === 'uploading' || from === 'processing' ? 'processing' : null;
    case 'deliver': {
      const to = event.outcome === 'kept' ? 'kept' : 'delivered';
      if (from === to) return to; // a replayed completion
      // A video that lands attaches, even after its row gave up on it (O14):
      // what it records is what happened.
      if (from === 'reserved' || from === 'uploading' || from === 'processing' || RESTARTABLE.has(from)) {
        return to;
      }
      return null;
    }
    case 'cancel':
      // A release of an export an Edit replaced: the newer one goes on.
      if (isStaleAttempt(row, event.clientKey)) return from;
      if (CANCELLABLE.has(from) || from === 'canceled') return event.reason === 'deleted' ? 'abandoned' : 'canceled';
      // Bytes in, an outcome, or already given up: unchanged (§5.3).
      return from;
    case 'artifactAbandoned':
      return from === 'reserved' || from === 'uploading' || from === 'abandoned' ? 'abandoned' : null;
    case 'retarget':
      return from === 'kept' ? 'delivered' : null;
    case 'refused':
      return from === null ? 'failed' : null;
    default:
      return null;
  }
}

// ─── PulseVault hooks ────────────────────────────────────────────────────────

/**
 * What a PulseVault hook does to the row its token names (`row`, null for an
 * upload that has none: the link flow). `event`:
 *  - `{ type: 'authorize', phase, artifactId }`: `authorize`; phase 'create' starts an upload.
 *  - `{ type: 'complete', artifactId }`: onArtifactEvent's `complete`.
 *  - `{ type: 'remove', reason, artifactId }`: onArtifactEvent's `remove`.
 *  - `{ type: 'uploadComplete', artifactId }`: onUploadComplete.
 * `isVideo`: the artifact is the video (not captions, the manifest or the
 * thumbnail, which go up first, under the same token, `relatedTo` it).
 *
 * Returns `{ action }`: `none`; `move` to `state`; `refuse` (403); or
 * `deliver`. Only the row's own video moves it, reserved → uploading →
 * processing; nothing here ever replaces its artifactId.
 */
export function hookDecision(row, event, isVideo) {
  if (!row) return { action: 'none' };
  const refuse = { action: 'refuse' };
  // A cancelled or abandoned row takes nothing more (§4), related artifacts included.
  if (event.type === 'authorize' && REFUSES_UPLOADS.has(row.state)) return refuse;
  // An older artifact of this row (renewed, or reissued after a cancel).
  if ((row.replacedArtifactIds ?? []).includes(event.artifactId)) {
    return event.type === 'authorize' ? refuse : { action: 'none' };
  }
  if (!isVideo) return { action: 'none' };
  // A video under this row's token that isn't the row's video.
  if (event.artifactId !== row.artifactId) return event.type === 'authorize' ? refuse : { action: 'none' };

  const move = (stateEvent) => {
    const to = nextState(row, stateEvent);
    return to && to !== row.state ? { action: 'move', state: to } : { action: 'none' };
  };
  switch (event.type) {
    case 'authorize':
      return event.phase === 'create' ? move({ type: 'authorize' }) : { action: 'none' };
    case 'complete':
      return move({ type: 'complete' });
    case 'remove':
      return event.reason === 'abandoned' ? move({ type: 'artifactAbandoned' }) : { action: 'none' };
    case 'uploadComplete':
      return { action: 'deliver' };
    default:
      return { action: 'none' };
  }
}

// ─── Sweep ───────────────────────────────────────────────────────────────────

/** How long after Send a video that hasn't landed counts as overdue. */
export const PULSE_OVERDUE_AFTER_MS = 24 * 60 * 60 * 1000;

/** Rows whose video hasn't landed yet. */
export const OVERDUE_STATES = Object.freeze(['intent', 'reserved', 'uploading']);

/**
 * Whether the sweep marks `row` overdue at `now` (ms): its video hasn't
 * landed 24 h after Send (`sentAt`, else `createdAt`), and it isn't marked
 * yet. Overdue is a flag (`overdueAt`), never a state: the row stays as it is
 * and a later video still attaches (O14).
 */
export function isOverdue(row, now) {
  if (!OVERDUE_STATES.includes(row.state) || row.overdueAt != null) return false;
  const since = row.sentAt ?? row.createdAt;
  if (since == null) return false;
  return new Date(since).getTime() <= now - PULSE_OVERDUE_AFTER_MS;
}

/**
 * The rows of `rows` the sweep sets `overdueAt` on.
 * @template T
 * @param {T[]} rows
 * @param {number} now
 * @returns {T[]}
 */
export function selectOverdue(rows, now) {
  return rows.filter((row) => isOverdue(row, now));
}

/** isOverdue as a `pulseUploads` query, for the sweep. */
export function overdueQuery(now) {
  const cutoff = new Date(now - PULSE_OVERDUE_AFTER_MS);
  return {
    state: { $in: [...OVERDUE_STATES] },
    overdueAt: null,
    $or: [{ sentAt: { $lte: cutoff } }, { sentAt: null, createdAt: { $lte: cutoff } }],
  };
}

// ─── Errors ──────────────────────────────────────────────────────────────────

/**
 * How Huddle tells Pulse a server refusal (`HostServiceError.code`), by the
 * Meteor.Error's `error`. Anything not here is `host.unavailable`, which
 * Pulse retries.
 */
export const PULSE_ERROR_CODES = Object.freeze({
  'not-found': 'destination.gone',
  forbidden: 'destination.gone',
  'bad-request': 'upload.refused',
  'validation-error': 'upload.refused',
  conflict: 'upload.refused',
  'too-large': 'upload.too_large',
  'not-authorized': 'no_account',
  'too-many-requests': 'host.unavailable',
});

/**
 * The Pulse code for a failed server call: `{ error?, status? }`, as a
 * Meteor.Error (`error`) or a Wormhole HTTP reply (`status`) gives it.
 * HTTP 401 is signed out; a network failure (no reply), 429 and 5xx are
 * `host.unavailable`. A reply with a status and no known `error` reads by
 * its status (PULSE_HTTP_STATUS_CODES), so a bare 403 or 404 is
 * `destination.gone`, not a retry forever.
 */
export function serverErrorToPulseCode(failure) {
  const status = typeof failure?.status === 'number' ? failure.status : null;
  if (status === 401) return 'no_account';
  if (status === 429 || (status != null && status >= 500)) return 'host.unavailable';
  const code = failure?.error;
  if (typeof code === 'string' && Object.hasOwn(PULSE_ERROR_CODES, code)) return PULSE_ERROR_CODES[code];
  if (status != null && Object.hasOwn(PULSE_HTTP_STATUS_CODES, status)) return PULSE_HTTP_STATUS_CODES[status];
  return 'host.unavailable';
}

/** The Pulse code for an HTTP reply that carries no Meteor `error`, by status. */
export const PULSE_HTTP_STATUS_CODES = Object.freeze({
  400: 'upload.refused',
  403: 'destination.gone',
  404: 'destination.gone',
  409: 'upload.refused',
  410: 'destination.gone',
  413: 'upload.too_large',
  422: 'upload.refused',
});
