/**
 * The kinds of video Pulse in the app records for TimeHuddle, with no Meteor
 * or database: what each is for (`id`), the place it is sent to (`target`),
 * the key that groups its drafts and rows, and what Pulse shows for it.
 *
 * A type is a thin map over a pulse-destinations.js kind. The two clock types
 * are the exception: their clock action runs at Send (clock.stopWithVideo /
 * clock.startWithPlan make the post and an `intent` row), so their video
 * only ever attaches to that post (`session-post`) and never clocks anyone
 * when it lands. Without that row (the Send-time call never succeeded) the
 * video still lands, as `fallbackType` would deliver it.
 *
 * `pulseUploadTypes.list` returns `pulseUploadTypeInfo` of each; the rest of
 * an entry stays on the server. Huddle's `src/features/pulse-embed/place.ts`
 * builds the same keys as `targetKey` here: tests on both sides pin one table.
 */

/**
 * The largest video PulseVault takes, in bytes (500 MB): an upload's
 * `maxUploadSize` there, and every type's `maxBytes`, which Pulse shows before
 * Send ("Too large to send to TimeHuddle") and `begin` refuses above.
 */
export const PULSE_MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

/** Longest key a Pulse context takes, as Pulse checks it (`PulseContext.key`). */
export const MAX_TARGET_KEY_LENGTH = 128;

/** A key as Pulse stores it: lowercase, and nothing a link or a filename would mangle. */
const TARGET_KEY_RE = /^[a-z0-9._:-]+$/;

/**
 * An id that can sit inside a key: no `:` (which separates a key's parts),
 * no `.`, and short. Ticket and session ids are ObjectId hex; teams and users
 * may be Meteor's random ids, whose case matters to the database.
 */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** A Huddle post's day, as huddle.js's POST_DATE_RE takes it. */
const POST_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const OBJECT_ID_RE = /^[0-9a-f]{24}$/i;

const isId = (value) => typeof value === 'string' && ID_RE.test(value);

/**
 * An id as the target keeps it: ObjectId hex lowercased (as `toHexString`
 * writes it, which is how pulse-destinations.js finds attachments again);
 * any other id as sent, since a Meteor id is case-sensitive.
 */
const asStored = (id) => (OBJECT_ID_RE.test(id) ? id.toLowerCase() : id);

/**
 * Each target kind: its normalised form (null when the shape is wrong) and
 * its key. A key lowercases every id, as Pulse requires; two Meteor ids that
 * differ only in case would share one, which only groups drafts together.
 */
const TARGETS = {
  ticket: {
    normalize: (t) => (isId(t.id) ? { kind: 'ticket', id: asStored(t.id) } : null),
    key: (t) => `ticket:${t.id.toLowerCase()}`,
  },
  clock: {
    normalize: (t) => (isId(t.id) ? { kind: 'clock', id: asStored(t.id) } : null),
    key: (t) => `clock:${t.id.toLowerCase()}`,
  },
  // Scoped by day, so yesterday's unsent plan is never offered today (PLAN
  // AD11, O10). The post exists only after Send, so no post id can name it.
  'clock-plan': {
    normalize: (t) =>
      isId(t.teamId) && typeof t.postDate === 'string' && POST_DATE_RE.test(t.postDate)
        ? { kind: 'clock-plan', teamId: asStored(t.teamId), postDate: t.postDate }
        : null,
    key: (t) => `clock-plan:${t.teamId.toLowerCase()}:${t.postDate}`,
  },
  // The conversation is where the post lands (decided at Send), not what the
  // drafts group by: one composer per team (O9).
  huddle: {
    normalize: (t) => {
      if (!isId(t.teamId)) return null;
      if (t.conversationId == null) return { kind: 'huddle', teamId: asStored(t.teamId) };
      if (!isId(t.conversationId)) return null;
      return { kind: 'huddle', teamId: asStored(t.teamId), conversationId: asStored(t.conversationId) };
    },
    key: (t) => `huddle:${t.teamId.toLowerCase()}`,
  },
  library: {
    normalize: () => ({ kind: 'library' }),
    key: (_t, userId) => `library:${String(userId).toLowerCase()}`,
  },
};

/**
 * One type. `targetKind` is the target the client sends; `destinationKind`
 * is how it is delivered (a pulse-destinations.js kind, or `session-post`);
 * `clock` says which clock action its Send runs. Clock types are
 * `requireOnline` (Send is disabled offline) and `confirmSend` (Pulse waits
 * for Huddle's clock call before it closes; PLAN AD23).
 */
function uploadType(id, fields) {
  return Object.freeze({
    id,
    version: 1,
    title: null,
    sendLabel: null, // Pulse's default: "Send to <label>"
    prompt: null,
    limits: null, // no length limit (F8); the size cap is maxBytes
    requireName: false,
    clock: null,
    requireOnline: false,
    confirmSend: false,
    maxBytes: PULSE_MAX_UPLOAD_BYTES,
    fallbackType: null,
    ...fields,
  });
}

export const PULSE_UPLOAD_TYPES = Object.freeze({
  'ticket.video': uploadType('ticket.video', {
    title: 'Ticket',
    targetKind: 'ticket',
    destinationKind: 'ticket',
  }),
  'clock.session': uploadType('clock.session', {
    title: 'Clock session',
    targetKind: 'clock',
    destinationKind: 'clock',
  }),
  // Shares `clock:<id>` with clock.session, so both group under one session;
  // Pulse matches the type too, so a session video is never offered as a wrap-up.
  'clock.wrapup': uploadType('clock.wrapup', {
    title: 'Wrap-up',
    sendLabel: 'Clock out & send',
    targetKind: 'clock',
    destinationKind: 'session-post',
    clock: 'stop',
    requireOnline: true,
    confirmSend: true,
    fallbackType: 'clock.session',
  }),
  'clock.plan': uploadType('clock.plan', {
    title: 'Plan',
    sendLabel: 'Clock in & send',
    targetKind: 'clock-plan',
    destinationKind: 'session-post',
    clock: 'start',
    requireOnline: true,
    confirmSend: true,
    fallbackType: 'library.video',
  }),
  'huddle.post': uploadType('huddle.post', {
    title: 'Post',
    targetKind: 'huddle',
    destinationKind: 'huddle',
  }),
  // No record button (F1): the place for kept videos and "Move to… → My library".
  'library.video': uploadType('library.video', {
    title: 'Library',
    targetKind: 'library',
    destinationKind: 'library',
  }),
});

export const PULSE_UPLOAD_TYPE_IDS = Object.freeze(Object.keys(PULSE_UPLOAD_TYPES));

/** The type with this id, or null. Own keys only: `constructor` isn't a type. */
export function pulseUploadType(id) {
  return typeof id === 'string' && Object.hasOwn(PULSE_UPLOAD_TYPES, id) ? PULSE_UPLOAD_TYPES[id] : null;
}

/** Whether a type's Send runs a clock action. */
export function isClockType(id) {
  return pulseUploadType(id)?.clock != null;
}

/**
 * What the client gets for a type (`PulseUploadTypeInfo`, the source of
 * Pulse's `UploadTypeSpec`); how it is delivered stays here. Null for an
 * unknown id.
 */
export function pulseUploadTypeInfo(id) {
  const type = pulseUploadType(id);
  if (!type) return null;
  return {
    id: type.id,
    version: type.version,
    targetKind: type.targetKind,
    title: type.title,
    sendLabel: type.sendLabel,
    prompt: type.prompt,
    limits: type.limits,
    requireName: type.requireName,
    clock: type.clock,
    requireOnline: type.requireOnline,
    confirmSend: type.confirmSend,
    maxBytes: type.maxBytes,
  };
}

/**
 * `target` in the form a row stores, when it is one `type` takes: the
 * fields of its kind and nothing else, ids checked. Null otherwise.
 */
export function normalizeTarget(typeId, target) {
  const type = pulseUploadType(typeId);
  if (!type || !target || typeof target !== 'object' || target.kind !== type.targetKind) return null;
  return TARGETS[type.targetKind].normalize(target);
}

/**
 * The key of `target` for `type`: Pulse's `context.key` and the row's
 * `targetKey`, the one place keys are built. `userId` names the library a
 * library video goes to. Null for a target the type doesn't take, or a key
 * Pulse wouldn't.
 */
export function targetKeyOf(typeId, target, userId) {
  const normalized = normalizeTarget(typeId, target);
  if (!normalized) return null;
  if (normalized.kind === 'library' && !isId(userId)) return null;
  const key = TARGETS[normalized.kind].key(normalized, userId);
  return isTargetKey(key) ? key : null;
}

/** Whether `key` is a key `targetKeyOf` could build (for `list({targetKey})` and the publications). */
export function isTargetKey(key) {
  if (typeof key !== 'string' || key.length > MAX_TARGET_KEY_LENGTH || !TARGET_KEY_RE.test(key)) return false;
  const [kind, ...parts] = key.split(':');
  const isPart = (part) => /^[a-z0-9_-]{1,64}$/.test(part);
  if (kind === 'clock-plan') return parts.length === 2 && isPart(parts[0]) && POST_DATE_RE.test(parts[1]);
  return Object.hasOwn(TARGETS, kind) && parts.length === 1 && isPart(parts[0]);
}

/**
 * The pulse-destinations.js destination whose `check` a begin runs for
 * `type` (`resolvePulseDestination(userId, …)`), or null for a clock type,
 * whose post was made at Send. `deliverAs` is the type delivery stands in
 * for: a clock type's `fallbackType` when its Send-time call never ran.
 */
export function destinationRequestOf(deliverAs, target) {
  const type = pulseUploadType(deliverAs);
  if (!type || type.destinationKind === 'session-post') return null;
  switch (type.destinationKind) {
    case 'ticket':
    case 'clock':
      return { kind: type.destinationKind, id: target.id };
    case 'huddle':
      return { kind: 'huddle', teamId: target.teamId };
    default:
      return { kind: 'library' };
  }
}
