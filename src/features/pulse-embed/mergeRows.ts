/**
 * One row per video (PLAN §5.1 flow A, §6.2 "Huddle UI state"): the drafts
 * on this phone (Pulse's catalog) merged with the server's record of their
 * uploads (`pulseUploads`) by draftKey, the video's identity across Edit,
 * resend and Move to…. A row keeps its key (the draftKey) from first record
 * to delivery, so the server's card replaces it in place, and it keeps this
 * phone's poster until the server's poster has loaded.
 *
 * Nothing persists here: the rows are derived from both sides on each read.
 */
import type { DraftSummary } from '@mieweb/pulse-embed';
import type { PulseUploadPublic, PulseUploadState } from '../../lib/api';

export interface PulseRow {
  /** Stable across the row's life: the draftKey, else `upload:<id>` for a server-only row. */
  key: string;
  draftKey: string | null;
  /** The draft (or its receipt) on this phone. */
  local: DraftSummary | null;
  /** The server's row for it. */
  server: PulseUploadPublic | null;
  name: string;
  durationMs: number | null;
  /** This phone's poster (`webUrl`), shown until the server's poster loads. */
  localPoster: string | null;
  /** The server delivered it: the place's own card (its attachment) takes the slot. */
  landed: boolean;
  /** Recorded by the signed-in person (false: someone else's, seen on their place). */
  mine: boolean;
  /** Newest first. */
  sortAt: number;
}

/** Server rows still on their way, as the publications send them (§6). */
export const IN_FLIGHT_STATES: ReadonlySet<PulseUploadState> = new Set([
  'intent',
  'reserved',
  'uploading',
  'processing',
]);

/** Server rows a row shows: on their way, or landed (delivered / kept). */
const SHOWN_SERVER_STATES: ReadonlySet<PulseUploadState> = new Set([
  ...IN_FLIGHT_STATES,
  'delivered',
  'kept',
]);

const timeOf = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** The newer of two server rows for the same video (a resend makes a newer one). */
function newer(a: PulseUploadPublic, b: PulseUploadPublic): PulseUploadPublic {
  const shownA = SHOWN_SERVER_STATES.has(a.state);
  const shownB = SHOWN_SERVER_STATES.has(b.state);
  if (shownA !== shownB) return shownA ? a : b;
  return (timeOf(b.updatedAt) ?? 0) > (timeOf(a.updatedAt) ?? 0) ? b : a;
}

export interface MergeOptions {
  /** The signed-in person: their server rows can belong to a draft on this phone. */
  userId?: string | null;
}

/** The uploads a draft has had on the server, by id (its current job and its receipt). */
function uploadIdsOf(draft: DraftSummary): string[] {
  return [draft.upload?.uploadId, draft.sent?.uploadId].filter((id): id is string => !!id);
}

/**
 * The rows for a place: every local draft, joined with its server row by
 * draftKey (or by the upload id the draft's job holds, for a live row that
 * came without its keys), plus the server rows with no draft on this phone
 * (another device's, or a receipt that expired).
 */
export function mergeRows(
  local: readonly DraftSummary[],
  server: readonly PulseUploadPublic[],
  options: MergeOptions = {},
): PulseRow[] {
  const byDraftKey = new Map<string, PulseUploadPublic>();
  const byId = new Map<string, PulseUploadPublic>();
  for (const upload of server) {
    byId.set(upload.id, upload);
    if (upload.draftKey) {
      const held = byDraftKey.get(upload.draftKey);
      byDraftKey.set(upload.draftKey, held ? newer(held, upload) : upload);
    }
  }

  const used = new Set<string>();
  const rows: PulseRow[] = [];

  for (const draft of local) {
    let match = byDraftKey.get(draft.draftKey) ?? null;
    if (!match) {
      for (const id of uploadIdsOf(draft)) {
        const found = byId.get(id);
        if (found && (!found.draftKey || found.draftKey === draft.draftKey)) match = found;
      }
    }
    // Every server row of this draft is accounted for, matched or not.
    for (const upload of server) {
      if (upload.draftKey === draft.draftKey || uploadIdsOf(draft).includes(upload.id)) {
        used.add(upload.id);
      }
    }
    const shown = match && SHOWN_SERVER_STATES.has(match.state) ? match : null;
    rows.push({
      key: draft.draftKey,
      draftKey: draft.draftKey,
      local: draft,
      server: shown,
      name: draft.name,
      durationMs: draft.durationMs,
      localPoster: draft.poster?.webUrl || null,
      landed: shown?.state === 'delivered',
      mine: true,
      sortAt: draft.createdAt,
    });
  }

  const serverOnly = new Map<string, PulseUploadPublic>();
  for (const upload of server) {
    if (used.has(upload.id) || !SHOWN_SERVER_STATES.has(upload.state)) continue;
    const key = upload.draftKey ?? `upload:${upload.id}`;
    const held = serverOnly.get(key);
    serverOnly.set(key, held ? newer(held, upload) : upload);
  }
  for (const [key, upload] of serverOnly) {
    rows.push({
      key,
      draftKey: upload.draftKey ?? null,
      local: null,
      server: upload,
      name: upload.name ?? '',
      durationMs: upload.durationMs,
      localPoster: null,
      landed: upload.state === 'delivered',
      mine: options.userId != null ? upload.userId === options.userId : !!upload.draftKey,
      sortAt: timeOf(upload.sentAt) ?? timeOf(upload.updatedAt) ?? 0,
    });
  }

  return rows.sort((a, b) => b.sortAt - a.sortAt || a.key.localeCompare(b.key));
}

/**
 * The server rows for a place from both sources: `pulseUploads.list` (the
 * caller's own, with their keys) and the live publication (everyone's on
 * their way, without keys). The live copy wins when it is as new or newer;
 * the keys always come from the list.
 */
export function mergeServerRows(
  listed: readonly PulseUploadPublic[],
  live: readonly PulseUploadPublic[],
): PulseUploadPublic[] {
  const out = new Map<string, PulseUploadPublic>();
  for (const row of listed) out.set(row.id, row);
  for (const row of live) {
    const held = out.get(row.id);
    if (!held) {
      out.set(row.id, row);
      continue;
    }
    if ((timeOf(row.updatedAt) ?? 0) >= (timeOf(held.updatedAt) ?? 0)) {
      out.set(row.id, {
        ...row,
        clientKey: held.clientKey ?? row.clientKey,
        draftKey: held.draftKey ?? row.draftKey,
      });
    }
  }
  return [...out.values()];
}

const isoOf = (value: unknown): string | null => {
  if (value == null) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  if (typeof value === 'object' && '$date' in (value as object)) {
    return isoOf(new Date((value as { $date: number | string }).$date));
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  return null;
};

const strOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : null;

/** A `pulseUploads` document from the DDP publication, as PulseUploadPublic. */
export function uploadFromDoc(doc: Record<string, unknown>): PulseUploadPublic | null {
  const id = strOrNull(doc._id);
  const state = strOrNull(doc.state) as PulseUploadState | null;
  if (!id || !state) return null;
  return {
    id,
    userId: String(doc.userId ?? ''),
    type: doc.type as PulseUploadPublic['type'],
    targetKey: String(doc.targetKey ?? ''),
    state,
    name: strOrNull(doc.name),
    durationMs: typeof doc.durationMs === 'number' ? doc.durationMs : null,
    sentAt: isoOf(doc.sentAt),
    updatedAt: isoOf(doc.updatedAt),
    reason: strOrNull(doc.reason),
    note: strOrNull(doc.note),
    attachmentId: strOrNull(doc.attachmentId),
    mediaId: strOrNull(doc.mediaId),
    ...(typeof doc.clientKey === 'string' ? { clientKey: doc.clientKey } : {}),
    ...(typeof doc.draftKey === 'string' ? { draftKey: doc.draftKey } : {}),
  };
}

/** Whether a row is moving, so the page polls (every 10 s) while it is on screen. */
export function isMoving(row: Pick<PulseRow, 'local' | 'server' | 'landed'>): boolean {
  if (row.landed) return false;
  if (row.server && IN_FLIGHT_STATES.has(row.server.state)) return true;
  const state = row.local?.state;
  return state === 'queued' || state === 'uploading' || state === 'delivering';
}

/**
 * Server rows seen on their way before (`before`: id → state) that are now
 * `delivered`: the place refetches its videos (H3). A row first seen already
 * delivered needs no refetch: the place's list was read after it landed.
 */
export function newlyDelivered(
  before: ReadonlyMap<string, PulseUploadState>,
  uploads: readonly PulseUploadPublic[],
): PulseUploadPublic[] {
  return uploads.filter(
    (u) => u.state === 'delivered' && before.has(u.id) && before.get(u.id) !== 'delivered',
  );
}

/**
 * Ids the live publication sent before and no longer does. It publishes rows
 * on their way only, so a row leaving it has landed (or was cancelled):
 * time to refetch the place's videos and the caller's own rows.
 */
export function leftPublication(
  before: ReadonlySet<string>,
  live: readonly Pick<PulseUploadPublic, 'id'>[],
): string[] {
  const now = new Set(live.map((u) => u.id));
  return [...before].filter((id) => !now.has(id));
}
