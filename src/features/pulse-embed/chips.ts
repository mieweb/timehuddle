/**
 * The state chip each video row carries (PLAN §5.2): text and an icon, never
 * colour alone, and whether the row needs the person (the attention count).
 * A row is a draft on this phone (Pulse's DraftSummary), the server's record
 * of the upload (PulseUploadPublic), or both merged by draftKey (mergeRows.ts).
 * Once the server has an outcome, that outcome is the row's state.
 */
import type { DraftSummary } from '@mieweb/pulse-embed';
import type { PulseUploadPublic } from '../../lib/api';
import { PULSE_EMBED_TEXT } from './pulseEmbedStrings';

/** Which icon a chip shows; OnThisPhoneRows maps each to its glyph. */
export type ChipIcon =
  | 'draft'
  | 'ready'
  | 'preparing'
  | 'queued'
  | 'offline'
  | 'uploading'
  | 'processing'
  | 'paused'
  | 'failed'
  | 'sent'
  | 'kept';

export type ChipTone = 'neutral' | 'progress' | 'warning' | 'danger' | 'success';

export interface Chip {
  /**
   * The state the chip stands for, without its numbers: a change of `state`
   * is announced, a change of percent is not.
   */
  state: string;
  text: string;
  icon: ChipIcon;
  tone: ChipTone;
  /** Counts toward "needs attention": a failed send, or a kept video not yet moved or dismissed. */
  attention: boolean;
}

export interface ChipOptions {
  /**
   * PulseKit can resume uploads without a screen (`info().capabilities`
   * includes `headless`, spike S3); a paused upload then resumes by itself.
   */
  headless?: boolean;
}

const T = PULSE_EMBED_TEXT.chip;

const chip = (
  state: string,
  text: string,
  icon: ChipIcon,
  tone: ChipTone = 'neutral',
  attention = false,
): Chip => ({ state, text, icon, tone, attention });

/** 0–1 progress as a whole percent, or null before the first byte. */
function percentOf(progress: number | undefined): number | null {
  if (typeof progress !== 'number' || !Number.isFinite(progress)) return null;
  return Math.round(Math.min(1, Math.max(0, progress)) * 100);
}

/** A draft's chip, from Pulse's own state for it. */
export function draftChip(draft: DraftSummary, options: ChipOptions = {}): Chip {
  switch (draft.state) {
    case 'ready':
      return chip('ready', T.ready, 'ready');
    case 'preparing':
      return chip('preparing', T.preparing, 'preparing', 'progress');
    case 'queued':
      return chip('queued', T.queued, 'queued', 'progress');
    case 'waiting_network':
      return chip('waiting_network', T.waitingNetwork, 'offline', 'warning');
    case 'uploading':
      return chip(
        'uploading',
        T.uploading(percentOf(draft.upload?.progress)),
        'uploading',
        'progress',
      );
    case 'delivering':
      return chip('delivering', T.delivering, 'processing', 'progress');
    case 'needs_credentials':
      return options.headless
        ? chip('needs_credentials', T.pausedAuto, 'paused', 'warning')
        : chip('needs_credentials', T.pausedTap, 'paused', 'warning');
    case 'failed':
      return draft.upload?.error?.code === 'upload.too_large'
        ? chip('failed', T.tooLarge, 'failed', 'danger', true)
        : chip('failed', T.failed, 'failed', 'danger', true);
    case 'sent':
      return draft.sent?.outcome === 'kept'
        ? chip('kept', T.kept(draft.sent.reason ?? null), 'kept', 'warning', !draft.sent.dismissed)
        : chip('sent', T.sent, 'sent', 'success');
    default:
      // `draft`, and any state a newer Pulse adds (read as a draft, AD18 rule 4).
      return chip('draft', T.draft, 'draft');
  }
}

/**
 * A server row's chip: what a viewer on another device sees, and what a row
 * on this phone becomes once the server has an outcome.
 */
export function serverChip(upload: PulseUploadPublic): Chip {
  switch (upload.state) {
    case 'intent':
      return chip('intent', T.waitingForVideo, 'queued', 'progress');
    case 'reserved':
    case 'uploading':
      return chip('uploading', T.uploadingElsewhere, 'uploading', 'progress');
    case 'processing':
      return chip('delivering', T.delivering, 'processing', 'progress');
    case 'delivered':
      return chip('sent', T.sent, 'sent', 'success');
    case 'kept':
      return chip('kept', T.kept(upload.reason), 'kept', 'warning', true);
    default:
      // canceled / failed / abandoned: the server gave up on this attempt.
      return chip('failed', T.failed, 'failed', 'danger', true);
  }
}

/** Server outcomes that replace whatever the phone still says. */
const SERVER_OUTCOMES = new Set<PulseUploadPublic['state']>(['delivered', 'kept']);

/**
 * The chip of a row that may have both sides: the server's outcome when it
 * has one (the phone may not have polled it yet), else the phone's state,
 * else the server's.
 */
export function rowChip(
  row: { local: DraftSummary | null; server: PulseUploadPublic | null },
  options: ChipOptions = {},
): Chip {
  const { local, server } = row;
  if (server && SERVER_OUTCOMES.has(server.state)) {
    // A kept video the person already dismissed on this phone needs nothing more.
    const kept = serverChip(server);
    if (server.state === 'kept' && local?.sent?.dismissed) return { ...kept, attention: false };
    return kept;
  }
  if (local) return draftChip(local, options);
  return server ? serverChip(server) : chip('draft', T.draft, 'draft');
}

/** How many rows need the person (§5.2's attention count). */
export function attentionCount(chips: readonly Chip[]): number {
  return chips.filter((c) => c.attention).length;
}
