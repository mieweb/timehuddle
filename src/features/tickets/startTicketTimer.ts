/**
 * Starting a ticket timer, shared by every place that offers one. Callers go
 * through `TicketStartProvider` (`features/timers`), which adds the clock-in
 * prompt and the toast around this.
 *
 * A ticket being timed belongs in the Tickets table and on My Board. A Redmine
 * issue joins the table by being pinned, so one the table doesn't have yet is
 * pinned first, then put on the board. Both steps are best-effort: the timer is
 * running either way, and the outcome says how far they got so the caller can
 * tell the user.
 */
import type { useToast } from '@mieweb/ui';
import { Play, Square } from 'lucide-react';
import { createElement } from 'react';

import {
  ApiError,
  myBoardApi,
  redmineApi,
  timerApi,
  type TicketSourceId,
  type TimerUpdateRef,
} from '../../lib/api';
import { toLocalDateStr } from '../../lib/date';

import { ticketTimerText as text } from '../timers/ticketTimerStrings';

/**
 * A stint shorter than this may be a slip: leaving the ticket asks whether its
 * update in Huddle is worth keeping (`TicketStartProvider`).
 */
export const SHORT_STINT_MS = 2 * 60 * 1000;

/**
 * What starting or stopping a ticket timer came to. A started timer's ticket
 * is put on My Board: `started-and-added` did that, `started-on-board` found it
 * already there, and plain `started` could not add it. `started-pin-limit` left
 * it off the table and My Board: the user is at the pin cap. `cancelled` is the
 * user backing out of the short-stint question; nothing changed.
 */
export type TicketTimerOutcome =
  | 'started'
  | 'started-and-added'
  | 'started-on-board'
  | 'started-pin-limit'
  | 'stopped'
  | 'clock-in'
  | 'cancelled'
  | 'failed';

/** A start's outcome, with the update it posted to Huddle (null when it posted none). */
export interface TicketTimerStart {
  outcome: TicketTimerOutcome;
  update: TimerUpdateRef | null;
}

export interface TimerTicket {
  sourceId: TicketSourceId;
  id: string;
}

export interface StartTicketTimerOptions {
  /** The Tickets table already shows this ticket, so there's nothing to pin. */
  inTable: boolean;
  /** My Board already has this ticket. */
  onBoard: boolean;
  /**
   * The running session whose Huddle update the user chose to discard. Named
   * by id, so the server discards that one and no other.
   */
  discardSessionId?: string;
}

/**
 * Turn a rejected timer start into something the user can act on. The shift
 * gate is the common one: a page's clocked-in state can be stale (another tab
 * clocked out, the 8h auto-clockout fired), so the server's answer is authoritative.
 */
export function timerErrorMessage(err: unknown): string {
  const code = err instanceof ApiError ? err.code : undefined;
  if (code === 'no-active-shift') return text.errorNoShift;
  if (code === 'not-connected') return text.errorNotConnected;
  if (code === 'unreachable' || code === 'invalid-key') return text.errorUnreachable;
  return text.errorStart;
}

/** Pin a Redmine issue into the Tickets table. True when the pin cap refused it. */
function pinRedmineIssue(issueId: number): Promise<boolean> {
  // The server pins on timer start too; this waits for it and hears the cap.
  return redmineApi.prefs.set(issueId, 'pinned').then(
    () => false,
    (err: unknown) => err instanceof ApiError && err.code === 'too-many-pins',
  );
}

/**
 * Start a timer on the ticket, then make sure it is in the table and on My Board.
 * Throws when the timer itself is refused; see `timerErrorMessage`.
 */
export async function startTicketTimer(
  ticket: TimerTicket,
  { inTable, onBoard, discardSessionId }: StartTicketTimerOptions,
): Promise<TicketTimerStart> {
  const result = await timerApi.createEntry({
    ticketId: ticket.id,
    source: ticket.sourceId,
    date: toLocalDateStr(new Date()),
    startNow: true,
    notifyAdmins: false,
    discardSessionId,
  });
  const update = result.update ?? null;
  if (!result.session) return { outcome: 'failed', update: null };

  // At the pin cap it never joins the table, so it stays off My Board too:
  // My Board shows only rows the table has.
  if (ticket.sourceId === 'redmine' && !inTable && (await pinRedmineIssue(Number(ticket.id)))) {
    return { outcome: 'started-pin-limit', update };
  }

  if (onBoard) return { outcome: 'started-on-board', update };
  try {
    await myBoardApi.addMany([{ sourceId: ticket.sourceId, ticketId: ticket.id }]);
    return { outcome: 'started-and-added', update };
  } catch {
    return { outcome: 'started', update };
  }
}

const toastIcon = (icon: typeof Play) =>
  createElement(icon, { className: 'h-4 w-4 fill-current', 'aria-hidden': true });

/**
 * Confirm a ticket timer's start or stop in a toast: what happened to the one
 * ticket, named by `label` (see `timerLabel`). `viewPost` opens the update the
 * action posted to Huddle, offered as the toast's action. False when the
 * outcome has nothing to confirm (it failed, was cancelled, or is waiting on a
 * clock-in).
 */
export function toastTimerOutcome(
  toast: ReturnType<typeof useToast>,
  outcome: TicketTimerOutcome,
  label: string,
  viewPost?: (() => void) | null,
): boolean {
  const options = (icon: typeof Play) => ({
    icon: toastIcon(icon),
    ...(viewPost ? { action: { label: text.viewPost, onClick: viewPost } } : {}),
  });
  if (outcome === 'started' || outcome === 'started-and-added' || outcome === 'started-on-board') {
    toast.success(text.started(label), options(Play));
  } else if (outcome === 'started-pin-limit') {
    toast.warning(text.startedPinLimit(label), options(Play));
  } else if (outcome === 'stopped') {
    toast.info(text.stopped(label), options(Square));
  } else return false;
  return true;
}
