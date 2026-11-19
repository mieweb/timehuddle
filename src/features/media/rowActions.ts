/**
 * What a row on the Unsent videos section does (PLAN §5.2): where a tap
 * goes (Pulse's editor, the row's sheet, the video's page, or nowhere), the
 * actions its sheet offers, and its ⋯ menu (Send, Move to…, Rename, Delete).
 * One table for every state, so no tap ever ends in a call Pulse refuses
 * (§6.1 lock rule) with nothing to show for it. Pure.
 */
import type { DraftSummary } from '@mieweb/pulse-embed';

import { rowChip } from '../pulse-embed/chips';
import type { PulseRow } from '../pulse-embed/mergeRows';
import { hasPlace, isClockBound } from './unsentRows';

/**
 * A row's state as it shows (rowChip's `state`): Pulse's DraftState, with a
 * receipt split into `sent` (attached) and `kept` (in the library), and the
 * server's outcome winning over a phone that hasn't polled it yet.
 */
export type RowState =
  | 'draft'
  | 'ready'
  | 'preparing'
  | 'queued'
  | 'waiting_network'
  | 'uploading'
  | 'delivering'
  | 'needs_credentials'
  | 'failed'
  | 'sent'
  | 'kept'
  /** The server's clock intent with no draft on this phone. */
  | 'intent';

export type RowTap = 'editor' | 'sheet' | 'watch' | 'nothing';

/** A sheet's buttons, in the order they show. */
export type SheetAction =
  'retry' | 'trim' | 'resume' | 'cancel' | 'edit' | 'move' | 'open' | 'dismiss' | 'delete';

/** The ⋯ menu's items, in the order they show. */
export type MenuAction = 'send' | 'move' | 'rename' | 'delete';

export interface RowFacts {
  state: RowState;
  /** The clock action ran at Send (O13): never moved. */
  clockBound: boolean;
  /** The draft says where it goes; one that doesn't can only be moved. */
  hasPlace: boolean;
  /** Failed as `upload.too_large`: trim it, a retry would fail the same way. */
  tooLarge: boolean;
  /** The video is on the server (its artifact), so it can be watched. */
  hasVideo: boolean;
  /** A kept receipt the person already dismissed. */
  dismissed: boolean;
}

const ROW_STATES: ReadonlySet<string> = new Set<RowState>([
  'draft',
  'ready',
  'preparing',
  'queued',
  'waiting_network',
  'uploading',
  'delivering',
  'needs_credentials',
  'failed',
  'sent',
  'kept',
  'intent',
]);

/** The artifact a row's video is, once it is on the server. */
export function videoIdOf(row: Pick<PulseRow, 'local' | 'server'>): string | null {
  return row.local?.sent?.artifactId || row.local?.upload?.artifactId || null;
}

/** The facts the table reads, from a merged row. */
export function rowFacts(row: PulseRow, options: { headless?: boolean } = {}): RowFacts {
  const chip = rowChip(row, options);
  const local: DraftSummary | null = row.local;
  const state = (ROW_STATES.has(chip.state) ? chip.state : 'draft') as RowState;
  return {
    state,
    clockBound: isClockBound(local),
    hasPlace: hasPlace(local?.context),
    tooLarge: local?.upload?.error?.code === 'upload.too_large',
    hasVideo: !!videoIdOf(row),
    dismissed: !!local?.sent?.dismissed || (state === 'kept' && !chip.attention),
  };
}

/**
 * States whose job is waiting in Pulse's outbox, which can start it at any
 * moment (the job ahead finishes, the network comes back, `resumeOutbox`).
 * Deleting one stops the job first (`cancelUpload`): once it is uploading,
 * `deleteDraft` is refused (§6.1 lock rule) and the video would still go.
 */
export function jobWaiting(state: RowState): boolean {
  return state === 'queued' || state === 'waiting_network' || state === 'needs_credentials';
}

/** Where tapping the row goes. */
export function rowTap(f: RowFacts): RowTap {
  switch (f.state) {
    case 'draft':
    case 'ready':
      return 'editor';
    case 'sent':
      return f.hasVideo ? 'watch' : 'nothing';
    case 'intent':
      return 'nothing';
    default:
      return 'sheet';
  }
}

/** Move to… is offered for an unsent or failed draft, or a kept video, never a clock-bound one. */
function movable(f: RowFacts): boolean {
  if (f.clockBound) return false;
  switch (f.state) {
    case 'draft':
    case 'ready':
    case 'queued':
    case 'waiting_network':
    case 'needs_credentials':
    case 'failed':
    case 'kept':
      return true;
    default:
      return false;
  }
}

/** The row's sheet: its buttons. Progress-only sheets have none. */
export function sheetActions(f: RowFacts): SheetAction[] {
  const move: SheetAction[] = movable(f) ? ['move'] : [];
  switch (f.state) {
    case 'queued':
    case 'waiting_network':
      return ['cancel', 'edit'];
    case 'uploading':
      return ['cancel'];
    case 'needs_credentials':
      return ['resume', 'cancel', 'edit'];
    case 'failed':
      // A retry can't send without a place: Move to… first.
      if (f.tooLarge) return ['trim', ...move, 'delete'];
      return [...(f.hasPlace ? (['retry'] as SheetAction[]) : []), ...move, 'edit', 'delete'];
    case 'kept':
      return [
        ...move,
        ...(f.hasVideo ? (['open'] as SheetAction[]) : []),
        ...(f.dismissed ? [] : (['dismiss'] as SheetAction[])),
      ];
    default:
      // draft, ready (they open the editor), preparing and delivering (progress
      // only), sent, intent.
      return [];
  }
}

/** The row's ⋯ menu. Empty: the row has no menu. */
export function menuActions(f: RowFacts): MenuAction[] {
  const move: MenuAction[] = movable(f) ? ['move'] : [];
  switch (f.state) {
    case 'draft':
    case 'ready':
      return [...(f.hasPlace ? (['send'] as MenuAction[]) : []), ...move, 'rename', 'delete'];
    case 'failed':
      return [
        ...(f.hasPlace && !f.tooLarge ? (['send'] as MenuAction[]) : []),
        ...move,
        'rename',
        'delete',
      ];
    case 'queued':
    case 'waiting_network':
    case 'needs_credentials':
      return [...move, 'delete'];
    case 'kept':
      return move;
    default:
      // preparing, uploading, delivering: locked (§6.1). sent, intent: nothing to change.
      return [];
  }
}
