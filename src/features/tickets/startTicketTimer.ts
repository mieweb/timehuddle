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

import { ApiError, myBoardApi, redmineApi, timerApi, type TicketSourceId } from '../../lib/api';
import { toLocalDateStr } from '../../lib/date';

import { ticketTimerText as text } from '../timers/ticketTimerStrings';

/**
 * What starting or stopping a ticket timer came to, for the toast. A started
 * timer's ticket is put on My Board: `started-and-added` did that,
 * `started-on-board` found it already there, and plain `started` could not add it.
 * `started-pin-limit` left it off the table and My Board: the user is at the pin cap.
 */
export type TicketTimerOutcome =
  | 'started'
  | 'started-and-added'
  | 'started-on-board'
  | 'started-pin-limit'
  | 'stopped'
  | 'clock-in'
  | 'failed';

export interface TimerTicket {
  sourceId: TicketSourceId;
  id: string;
}

export interface StartTicketTimerOptions {
  /** The Tickets table already shows this ticket, so there's nothing to pin. */
  inTable: boolean;
  /** My Board already has this ticket. */
  onBoard: boolean;
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
  { inTable, onBoard }: StartTicketTimerOptions,
): Promise<TicketTimerOutcome> {
  const result = await timerApi.createEntry({
    ticketId: ticket.id,
    source: ticket.sourceId,
    date: toLocalDateStr(new Date()),
    startNow: true,
    notifyAdmins: false,
  });
  if (!result.session) return 'failed';

  // At the pin cap it never joins the table, so it stays off My Board too:
  // My Board shows only rows the table has.
  if (ticket.sourceId === 'redmine' && !inTable && (await pinRedmineIssue(Number(ticket.id)))) {
    return 'started-pin-limit';
  }

  if (onBoard) return 'started-on-board';
  try {
    await myBoardApi.addMany([{ sourceId: ticket.sourceId, ticketId: ticket.id }]);
    return 'started-and-added';
  } catch {
    return 'started';
  }
}

/**
 * Confirm a ticket timer's start or stop in a toast, naming the ticket by
 * `label` (see `timerLabel`). A start that stopped another ticket's timer names
 * that one too. False when the outcome has nothing to confirm (it failed, or is
 * waiting on a clock-in).
 */
export function toastTimerOutcome(
  toast: ReturnType<typeof useToast>,
  outcome: TicketTimerOutcome,
  label: string,
  stoppedLabel?: string | null,
): boolean {
  const withSwitch = (message: string) =>
    stoppedLabel ? text.switched(stoppedLabel, message) : message;
  if (outcome === 'started-and-added') toast.success(withSwitch(text.startedAndAdded(label)));
  else if (outcome === 'started-on-board') toast.success(withSwitch(text.startedOnBoard(label)));
  else if (outcome === 'started') toast.success(withSwitch(text.started(label)));
  else if (outcome === 'started-pin-limit') toast.warning(withSwitch(text.startedPinLimit(label)));
  else if (outcome === 'stopped') toast.info(text.stopped(label));
  else return false;
  return true;
}
