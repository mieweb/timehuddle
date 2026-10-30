/**
 * The wording of the automatic Huddle update a ticket timer posts when it
 * starts, switches, stops or resumes ("Started TH-12: Fix login"). Pure: no
 * Meteor, no database, so it is unit-tested directly.
 *
 * Every word of an update is in this module, as the seam a translation will
 * plug into. How the ticket is named is `ticket-label.js` (#788).
 */
import { ticketName } from './ticket-label';

export const TimerUpdate = {
  STARTED: 'started',
  SWITCHED: 'switched',
  STOPPED: 'stopped',
  RESUMED: 'resumed',
};

const WORDING = {
  [TimerUpdate.STARTED]: (ticket) => `Started ${ticket}`,
  [TimerUpdate.SWITCHED]: (ticket) => `Switched to ${ticket}`,
  [TimerUpdate.STOPPED]: (ticket) => `Stopped ${ticket}`,
  [TimerUpdate.RESUMED]: (ticket) => `Resumed ${ticket}`,
};

/** A title is user text going into markdown: its own markup must not take effect. */
function escapeMarkdown(text) {
  return text.replace(/([\\`*_[\]()<>])/g, '\\$1');
}

/**
 * The update as markdown: one italic line with the ticket linked.
 * @param {string} action one of `TimerUpdate`
 * @param {{ ref: string, title: string | null, path: string }} label from
 *   `huddleTicketLabel` or `redmineIssueLabel` (ticket-label.js)
 */
export function timerUpdateText(action, label) {
  return `*${WORDING[action](`[${escapeMarkdown(ticketName(label))}](${label.path})`)}*`;
}

/**
 * What a timer start posts, given what was running before it.
 *
 * Starting the work item that was already running is not news. Taking over
 * from another ticket is a switch, unless that ticket's own update is being
 * discarded: then nothing is left to switch from, and it reads as a start.
 * @returns {string | null} a `TimerUpdate`, or null for no post
 */
export function startAction({ previousWorkItemId, workItemId, discardPrevious = false }) {
  if (!previousWorkItemId) return TimerUpdate.STARTED;
  if (previousWorkItemId === workItemId) return null;
  return discardPrevious ? TimerUpdate.STARTED : TimerUpdate.SWITCHED;
}
