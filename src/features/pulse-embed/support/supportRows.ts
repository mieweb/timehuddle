/**
 * The pure side of Pulse support (TH-4): what an admin types into the search
 * as an `adminList` query, the rows as the support table shows them (one flat
 * row each, with its overdue and abandoned flags), and the metrics as text.
 */
import type {
  PulseUploadAdmin,
  PulseUploadMetrics,
  PulseUploadState,
  PulseUploadTypeId,
} from '../../../lib/api';
import { SUPPORT_TEXT as T } from './supportStrings';

export type SupportMode = 'recent' | 'person' | 'ticket' | 'session';

/** What an `adminList` call takes. */
export interface SupportQuery {
  userId?: string;
  targetKey?: string;
  clockEventId?: string;
  limit?: number;
}

/** The most rows one search shows (adminList's cap). */
export const SUPPORT_LIMIT = 100;

/** 24 h after Send: the server's overdue line (PULSE_OVERDUE_AFTER_MS). */
export const OVERDUE_AFTER_MS = 24 * 60 * 60 * 1000;

const OBJECT_ID = /\b([0-9a-f]{24})\b/i;
const TICKET_PATH = /\/tickets\/([0-9a-f]{24})\b/i;
const OVERDUE_STATES = new Set<PulseUploadState>(['intent', 'reserved', 'uploading']);

/** A ticket's id from its id or any link to its page; null for anything else. */
export function ticketIdOf(input: string): string | null {
  const text = input.trim();
  const id = TICKET_PATH.exec(text)?.[1] ?? (/^[0-9a-f]{24}$/i.test(text) ? text : null);
  return id ? id.toLowerCase() : null;
}

/** A clock session's id from its id or text holding one; null for anything else. */
export function sessionIdOf(input: string): string | null {
  const id = OBJECT_ID.exec(input.trim())?.[1];
  return id ? id.toLowerCase() : null;
}

/**
 * The `adminList` query for a search, or an error to show. `recent` has no
 * filter; the section keeps the selected team's rows (supportRowsForTeam).
 */
export function supportQuery(
  mode: SupportMode,
  { userId, ticket, session }: { userId?: string; ticket?: string; session?: string },
): { query: SupportQuery } | { error: string } {
  const limit = SUPPORT_LIMIT;
  switch (mode) {
    case 'person':
      return userId ? { query: { userId, limit } } : { error: T.personPlaceholder };
    case 'ticket': {
      const id = ticketIdOf(ticket ?? '');
      return id ? { query: { targetKey: `ticket:${id}`, limit } } : { error: T.badTicket };
    }
    case 'session': {
      const id = sessionIdOf(session ?? '');
      return id ? { query: { clockEventId: id, limit } } : { error: T.badSession };
    }
    default:
      return { query: { limit } };
  }
}

/** One row of the support table: scalars only, as the grid wants them. */
export interface SupportRow extends Record<string, unknown> {
  id: string;
  sentAt: string | null;
  userName: string;
  type: string;
  place: string;
  state: string;
  flags: string;
  reason: string;
  updatedAt: string | null;
  device: string;
}

const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : null);

/**
 * The row's flags at `now`: overdue (the sweep's flag, or still on its way
 * 24 h after Send before the sweep ran), abandoned, or arrived late (attached
 * more than 24 h after Send; delivery clears the overdue flag).
 */
export function supportFlags(upload: PulseUploadAdmin, now: number): string[] {
  const sent = ms(upload.sentAt) ?? ms(upload.createdAt);
  const flags: string[] = [];
  if (OVERDUE_STATES.has(upload.state)) {
    if (upload.overdueAt || (sent != null && now - sent >= OVERDUE_AFTER_MS))
      flags.push(T.flags.overdue);
  }
  if (upload.state === 'abandoned') flags.push(T.flags.abandoned);
  if (upload.state === 'delivered' || upload.state === 'kept') {
    const landed = ms(upload.deliveredAt);
    if (sent != null && landed != null && landed - sent >= OVERDUE_AFTER_MS)
      flags.push(T.flags.late);
  }
  return flags;
}

const typeLabel = (type: string) => T.types[type as PulseUploadTypeId] ?? type;
const stateLabel = (state: string) => T.states[state as PulseUploadState] ?? state;

/** One upload as the support table shows it. */
export function toSupportRow(upload: PulseUploadAdmin, now: number): SupportRow {
  const device = [upload.platform, upload.appVersion].filter(Boolean).join(' ');
  return {
    id: upload.id,
    sentAt: upload.sentAt ?? upload.createdAt ?? null,
    userName: upload.userName || T.unknownPerson,
    type: typeLabel(upload.type),
    place: upload.label || upload.targetKey,
    state: stateLabel(upload.state),
    flags: supportFlags(upload, now).join(', '),
    reason: upload.reason ?? upload.note ?? '',
    updatedAt: upload.updatedAt ?? null,
    device,
  };
}

/** The rows of `uploads` in `teamId` (adminList also returns the caller's own rows anywhere). */
export function supportRowsForTeam(
  uploads: PulseUploadAdmin[],
  teamId: string,
  now: number,
): SupportRow[] {
  return uploads
    .filter((upload) => upload.teamId === teamId)
    .map((upload) => toSupportRow(upload, now));
}

// ─── Metrics as text ──────────────────────────────────────────────────────────

/** A 0–1 rate as a whole percent; a dash when nothing was sent. */
export function percentText(rate: number | null): string {
  return rate == null ? '–' : `${Math.round(rate * 100)}%`;
}

/** A duration as the largest whole unit that reads well: "45 s", "3 min", "2.5 h", "3 d". */
export function durationText(msValue: number | null): string {
  if (msValue == null) return '–';
  const s = msValue / 1000;
  if (s < 60) return `${Math.round(s)} s`;
  const min = s / 60;
  if (min < 60) return `${Math.round(min)} min`;
  const h = min / 60;
  if (h < 48) return `${Math.round(h * 10) / 10} h`;
  return `${Math.round((h / 24) * 10) / 10} d`;
}

/** The metrics as label/value pairs, in the order the section lists them. */
export function metricItems(metrics: PulseUploadMetrics): Array<{ label: string; value: string }> {
  const { counts, rates, timeToAttachMs, duplicateAttachments } = metrics;
  return [
    { label: T.metric.sent, value: String(counts.sent) },
    { label: T.metric.attached, value: percentText(rates.success) },
    {
      label: T.metric.timeToAttach,
      value: `${durationText(timeToAttachMs.p50)} · ${durationText(timeToAttachMs.p95)}`,
    },
    { label: T.metric.failed, value: percentText(rates.failed) },
    { label: T.metric.overdue, value: percentText(rates.overdue) },
    { label: T.metric.abandoned, value: percentText(rates.abandoned) },
    { label: T.metric.duplicates, value: String(duplicateAttachments.extra) },
  ];
}
