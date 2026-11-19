/**
 * Where a Pulse video recorded in the app goes, as Pulse and the server both
 * name it (huddle-server §2, §16). `pulsePlace` turns a place on screen (a
 * ticket, an open session, a day's plan, a team's Huddle, the library) into
 * the PulseContext Pulse records for: its `key` groups the place's drafts
 * and is the server's `targetKey`; its `data` carries the upload type and
 * target that grants.ts sends to `pulseUploads.begin` at Send.
 *
 * The key table mirrors meteor-backend/server/pulse-upload-types.js
 * (`targetKeyOf`, `normalizeTarget`) rule for rule; both sides' tests pin
 * the same literal vectors, so a change to one is a change to the other.
 */
import type { PulseUploadTarget, PulseUploadTypeId, PulseUploadTypeInfo } from '../../lib/api';
import type { PulseContext, UploadTypeSpec } from './client';

/** Longest key Pulse takes (`PulseContext.key`). */
export const MAX_PLACE_KEY_LENGTH = 128;

/** Longest label Pulse shows (`PulseContext.label`). */
export const MAX_PLACE_LABEL_LENGTH = 120;

/** An id that can sit inside a key: no `:` or `.`, and short (the server's ID_RE). */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** A Huddle post's day. */
const POST_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const OBJECT_ID_RE = /^[0-9a-f]{24}$/i;
const KEY_RE = /^[a-z0-9._:-]+$/;

const isId = (value: unknown): value is string => typeof value === 'string' && ID_RE.test(value);
const isPostDate = (value: unknown): value is string =>
  typeof value === 'string' && POST_DATE_RE.test(value);

/** ObjectId hex lowercased, as the database writes it; a Meteor id as sent (its case matters). */
const asStored = (id: string) => (OBJECT_ID_RE.test(id) ? id.toLowerCase() : id);

/** The target kind each upload type takes. */
export const PULSE_TARGET_KIND: Readonly<Record<PulseUploadTypeId, PulseUploadTarget['kind']>> =
  Object.freeze({
    'ticket.video': 'ticket',
    'clock.session': 'clock',
    'clock.wrapup': 'clock',
    'clock.plan': 'clock-plan',
    'huddle.post': 'huddle',
    'library.video': 'library',
  });

export const PULSE_UPLOAD_TYPE_IDS = Object.keys(PULSE_TARGET_KIND) as PulseUploadTypeId[];

export function isPulseUploadTypeId(value: unknown): value is PulseUploadTypeId {
  return typeof value === 'string' && Object.hasOwn(PULSE_TARGET_KIND, value);
}

type AnyTarget = { kind?: unknown; [field: string]: unknown };

/**
 * `target` in the form the server stores, when it is one `type` takes: the
 * fields of its kind and nothing else, ids checked. Null otherwise.
 */
export function normalizeTarget(type: unknown, target: unknown): PulseUploadTarget | null {
  if (!isPulseUploadTypeId(type) || !target || typeof target !== 'object') return null;
  const t = target as AnyTarget;
  if (t.kind !== PULSE_TARGET_KIND[type]) return null;
  switch (t.kind) {
    case 'ticket':
    case 'clock':
      return isId(t.id) ? { kind: t.kind, id: asStored(t.id) } : null;
    case 'clock-plan':
      return isId(t.teamId) && isPostDate(t.postDate)
        ? { kind: 'clock-plan', teamId: asStored(t.teamId), postDate: t.postDate }
        : null;
    case 'huddle':
      if (!isId(t.teamId)) return null;
      if (t.conversationId == null) return { kind: 'huddle', teamId: asStored(t.teamId) };
      return isId(t.conversationId)
        ? { kind: 'huddle', teamId: asStored(t.teamId), conversationId: asStored(t.conversationId) }
        : null;
    default:
      return { kind: 'library' };
  }
}

/**
 * The key of `target` for `type`: Pulse's `context.key` and the server's
 * `targetKey`. Every id is lowercased; a plan is scoped by its day, so
 * yesterday's unsent plan is never offered today; a Huddle post groups by
 * team, not by the conversation it lands in. `userId` names the library.
 * Null for a target the type doesn't take.
 */
export function targetKeyOf(type: unknown, target: unknown, userId?: string | null): string | null {
  const t = normalizeTarget(type, target);
  if (!t) return null;
  let key: string;
  switch (t.kind) {
    case 'ticket':
      key = `ticket:${t.id.toLowerCase()}`;
      break;
    case 'clock':
      key = `clock:${t.id.toLowerCase()}`;
      break;
    case 'clock-plan':
      key = `clock-plan:${t.teamId.toLowerCase()}:${t.postDate}`;
      break;
    case 'huddle':
      key = `huddle:${t.teamId.toLowerCase()}`;
      break;
    default:
      if (!isId(userId)) return null;
      key = `library:${userId.toLowerCase()}`;
  }
  return key.length <= MAX_PLACE_KEY_LENGTH && KEY_RE.test(key) ? key : null;
}

/** A place on screen, by upload type. `label` is what Pulse calls it ("Fix login", "Platform"). */
export type PulsePlaceInput = (
  | { type: 'ticket.video'; ticketId: string }
  | { type: 'clock.session'; clockEventId: string }
  /** The session's team and the post's day, for the clock-out call at Send. */
  | { type: 'clock.wrapup'; clockEventId: string; teamId: string; postDate: string }
  | { type: 'clock.plan'; teamId: string; postDate: string }
  /** The conversation the composer is in, when the team has conversations (after #871). */
  | { type: 'huddle.post'; teamId: string; conversationId?: string | null }
  | { type: 'library.video'; userId: string }
) & {
  label: string;
  /** The type as `pulseUploadTypes.list` gave it; becomes `context.uploadType`. */
  uploadType?: PulseUploadTypeInfo | null;
};

/**
 * What Huddle keeps in `context.data`, and reads back at Send: the server's
 * type and target, plus for a wrap-up the team and day the clock-out call needs.
 */
export interface PulsePlaceData {
  type: PulseUploadTypeId;
  target: PulseUploadTarget;
  clock?: { teamId: string; postDate: string };
}

export interface PulsePlace {
  context: PulseContext;
  type: PulseUploadTypeId;
  target: PulseUploadTarget;
}

function targetOf(input: PulsePlaceInput): unknown {
  switch (input.type) {
    case 'ticket.video':
      return { kind: 'ticket', id: input.ticketId };
    case 'clock.session':
    case 'clock.wrapup':
      return { kind: 'clock', id: input.clockEventId };
    case 'clock.plan':
      return { kind: 'clock-plan', teamId: input.teamId, postDate: input.postDate };
    case 'huddle.post':
      return { kind: 'huddle', teamId: input.teamId, conversationId: input.conversationId };
    case 'library.video':
      return { kind: 'library' };
  }
}

/** The key's suffix as the host spells it (case kept): `PulseContext.id`. */
function idOf(input: PulsePlaceInput): string {
  switch (input.type) {
    case 'ticket.video':
      return input.ticketId;
    case 'clock.session':
    case 'clock.wrapup':
      return input.clockEventId;
    case 'clock.plan':
      return `${input.teamId}:${input.postDate}`;
    case 'huddle.post':
      return input.teamId;
    case 'library.video':
      return input.userId;
  }
}

/** Pulse's UploadTypeSpec for a type the server listed: its fields, with nulls left out (JSON). */
export function uploadTypeSpecOf(info: PulseUploadTypeInfo): UploadTypeSpec {
  return {
    id: info.id,
    version: info.version,
    ...(info.title != null ? { title: info.title } : {}),
    ...(info.sendLabel != null ? { sendLabel: info.sendLabel } : {}),
    ...(info.prompt != null ? { prompt: info.prompt } : {}),
    ...(info.limits != null ? { limits: { ...info.limits } } : {}),
    requireName: info.requireName,
    requireOnline: info.requireOnline,
    confirmSend: info.confirmSend,
    maxBytes: info.maxBytes,
  };
}

/**
 * The PulseContext for a place, with the type and target it sends to; null
 * when the place can't be one (an id that would break a key, a plan without
 * its day, a library without its user).
 */
export function pulsePlace(input: PulsePlaceInput): PulsePlace | null {
  const target = normalizeTarget(input.type, targetOf(input));
  const key =
    target && targetKeyOf(input.type, target, input.type === 'library.video' ? input.userId : null);
  if (!target || !key) return null;
  if (input.type === 'clock.wrapup' && (!isId(input.teamId) || !isPostDate(input.postDate))) {
    return null;
  }
  const kind = key.slice(0, key.indexOf(':'));
  const uploadType =
    input.uploadType?.id === input.type ? uploadTypeSpecOf(input.uploadType) : null;
  const label = input.label.trim().slice(0, MAX_PLACE_LABEL_LENGTH) || uploadType?.title || key;
  const data: PulsePlaceData =
    input.type === 'clock.wrapup'
      ? { type: input.type, target, clock: { teamId: input.teamId, postDate: input.postDate } }
      : { type: input.type, target };
  const context: PulseContext = {
    key,
    kind,
    id: idOf(input),
    label,
    ...(uploadType ? { uploadType } : {}),
    data: data as unknown as PulseContext['data'],
  };
  return { context, type: input.type, target };
}

/**
 * The type and target a context was recorded for (`context.data`, written by
 * pulsePlace and never changed after Send), or null when it isn't one Huddle
 * made: a draft without it can't be sent anywhere until it is moved.
 */
export function placeData(context: PulseContext | null | undefined): PulsePlaceData | null {
  const data = context?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const {
    type,
    target: raw,
    clock,
  } = data as { type?: unknown; target?: unknown; clock?: unknown };
  const target = normalizeTarget(type, raw);
  if (!target || !isPulseUploadTypeId(type)) return null;
  if (clock && typeof clock === 'object' && !Array.isArray(clock)) {
    const { teamId, postDate } = clock as { teamId?: unknown; postDate?: unknown };
    if (isId(teamId) && isPostDate(postDate)) return { type, target, clock: { teamId, postDate } };
  }
  return { type, target };
}
