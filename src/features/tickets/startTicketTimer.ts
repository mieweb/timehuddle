/**
 * Starting a ticket timer, shared by every place that offers one. Callers go
 * through `TicketStartProvider` (`features/timers`), which adds the clock-in
 * prompt and the toast around this.
 *
 * A ticket being timed belongs in the Tickets table and on My Board. A Redmine
 * issue is timed as the ticket carrying it in the selected team, found or
 * created first (`carryIssue.ts`, #736); being a ticket, that is in the table.
 * Only a Redmine issue that can't be carried (its account is on another
 * server) still joins the table by being pinned. Putting it on the board is
 * best-effort: the timer is running either way, and the outcome says how far
 * it got so the caller can tell the user.
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
  type UnsentRedmineTime,
} from '../../lib/api';
import { toLocalDateStr } from '../../lib/date';

import { ticketTimerText as text } from '../timers/ticketTimerStrings';
import { boardText } from './boardStrings';
import { NoTeamError, carriedKey } from './carryIssue';
import { ticketKey, ticketRefOf } from './sources';

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
  /** What the ticket this start took over from left to send to Redmine. */
  unsentRedmine?: UnsentRedmineTime | null;
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
  /** The selected team, where a Redmine issue's carrying ticket is (#736). */
  teamId: string | null;
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
  if (err instanceof NoTeamError) return boardText.noTeam;
  const code = err instanceof ApiError ? err.code : undefined;
  if (code === 'no-active-shift') return text.errorNoShift;
  if (code === 'issue-unavailable') return text.errorIssueUnavailable;
  if (code === 'carry-busy') return text.errorCarryBusy;
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
  { inTable, onBoard, teamId, discardSessionId }: StartTicketTimerOptions,
): Promise<TicketTimerStart> {
  const carried = ticketRefOf(await carriedKey(ticketKey(ticket.sourceId, ticket.id), teamId));
  const timed: TimerTicket = { sourceId: carried.sourceId as TicketSourceId, id: carried.ticketId };
  // The carrying ticket may be new, or not on the board yet; adding is idempotent.
  const alreadyOnBoard = onBoard && timed.sourceId === ticket.sourceId;

  const result = await timerApi.createEntry({
    ticketId: timed.id,
    source: timed.sourceId,
    date: toLocalDateStr(new Date()),
    startNow: true,
    notifyAdmins: false,
    discardSessionId,
  });
  const update = result.update ?? null;
  if (!result.session) return { outcome: 'failed', update: null };
  const unsentRedmine = result.unsentRedmine ?? null;

  // At the pin cap it never joins the table, so it stays off My Board too:
  // My Board shows only rows the table has.
  if (timed.sourceId === 'redmine' && !inTable && (await pinRedmineIssue(Number(timed.id)))) {
    return { outcome: 'started-pin-limit', update, unsentRedmine };
  }

  if (alreadyOnBoard) return { outcome: 'started-on-board', update, unsentRedmine };
  try {
    await myBoardApi.addMany([{ sourceId: timed.sourceId, ticketId: timed.id }]);
    return { outcome: 'started-and-added', update, unsentRedmine };
  } catch {
    return { outcome: 'started', update, unsentRedmine };
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
