/**
 * Every user-facing string about starting and stopping a ticket timer, for any
 * ticket (Huddle or Redmine) and every place a timer starts.
 *
 * The translation seam, like `tickets/redmine/suggestionStrings.ts`: components
 * read this text only from here, and anything built from values is a function.
 * A `label` is how a ticket is named in a sentence; see `timerLabel`.
 */
import type { TicketSourceId } from '../../lib/api';
import { huddleTicketRef } from '../tickets/sources/huddleSource';

/**
 * How a ticket is named in a timer message: a Redmine issue by its number,
 * which is how people refer to it, and a Huddle ticket by its title, since it
 * has no number (its short ref is the fallback when the title is unknown).
 */
export function timerLabel(source: TicketSourceId, id: string, title?: string | null): string {
  if (source === 'redmine') return `#${id}`;
  return title?.trim() || huddleTicketRef(id);
}

export const ticketTimerText = {
  /** The timer button where it has room for words, and its name for one ticket. */
  start: 'Start timer',
  stop: 'Stop timer',
  startLabel: (label: string) => `Start a timer on ${label}`,
  stopLabel: (label: string) => `Stop the timer on ${label}`,
  /**
   * The start button of a ticket that is not on My Board: starting puts it
   * there, so the button says so before it is pressed.
   */
  addAndStart: 'Add & Start',
  addAndStartLabel: (label: string) => `Add ${label} to My Board and start timer`,

  /** The toast: what happened to one ticket, and nothing else. */
  started: (label: string) => `Started ${label}`,
  /** 500 is the server's `MAX_PINS_PER_USER`. */
  startedPinLimit: (label: string) =>
    `Started ${label}. You've reached the 500-pin limit, so it wasn't added to your Tickets or My Board.`,
  stopped: (label: string) => `Stopped ${label}`,
  /** Opens the update the start or stop posted to Huddle. */
  viewPost: 'View post',

  /**
   * Asked when the user leaves a ticket after a very short stint: its update
   * in Huddle may be a slip not worth telling the team about.
   */
  shortStintTitle: 'Keep this update?',
  shortStintSwitch: (label: string) =>
    `You're switching away from ${label} after less than 2 minutes. Keep its update in Huddle, or discard it?`,
  shortStintStop: (label: string) =>
    `You're stopping ${label} after less than 2 minutes. Keep its update in Huddle, or discard it?`,
  keepUpdate: 'Keep update',
  discardUpdate: 'Discard update',
  promptTitle: 'Clock In Required',
  promptBody: 'You must be clocked in before starting a timer. Do you want to clock in now?',
  promptPlanBody: (label: string) =>
    `Your team asks for today's plan before you clock in. Write it on the Clock page, and the timer on ${label} starts as soon as you're clocked in.`,
  clockInNow: 'Clock In Now',
  writePlan: "Write today's plan",
  cancel: 'Cancel',
  selectTeamFirst: 'Select a team before clocking in.',
  clockInFailed: 'Could not clock in. Please try again.',

  /** Why a start or stop failed; see `timerErrorMessage`. */
  errorNoShift: 'Clock in to start a ticket timer.',
  errorNotConnected: 'Connect your Redmine account in Settings to time this issue.',
  errorUnreachable: 'Could not reach Redmine to start this timer.',
  errorStart: 'Could not start the timer. Please try again.',
  errorStop: 'Could not stop the timer. Please try again.',

  /** On the Clock page while a start waits for the clock-in. */
  pendingStart: (label: string) => `The timer on ${label} starts when you clock in.`,
  cancelPendingStart: 'Cancel',
  cancelPendingStartLabel: (label: string) => `Don't start the timer on ${label}`,
  clockOutStopsTimer: (label: string) => `Clocking out will stop the timer on ${label}.`,
};
