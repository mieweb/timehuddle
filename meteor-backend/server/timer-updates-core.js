/**
 * The wording of the automatic Huddle update a ticket timer posts when it
 * starts, switches, stops or resumes ("Started #3fa2c: Fix login"). Pure: no
 * Meteor, no database, so it is unit-tested directly.
 *
 * Every word of an update is in this module, as the seam a translation will
 * plug into. A Redmine issue is named by its number only ("#200 ticket of
 * Redmine"): its subject may carry patient information and is never stored in
 * TimeHuddle (see `collections.js`).
 */

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

/** How a Redmine issue reads after its linked number: "#200 ticket of Redmine". */
const OF_REDMINE = 'ticket of Redmine';

/** The ticket's own page in the app, where a reader with access sees the rest. */
export function ticketPath(source, ticketId) {
  return source === 'redmine' ? `/app/tickets/redmine/${ticketId}` : `/app/tickets/${ticketId}`;
}

/**
 * A Huddle ticket's short reference, e.g. `#3fa2c`: the tail of its id, as the
 * Tickets table and the ticket page show it (`huddleTicketRef` in the app).
 */
export function huddleTicketRef(ticketId) {
  return `#${String(ticketId).slice(-5)}`;
}

/**
 * How an update names a ticket: `#200` for a Redmine issue; the short
 * reference and the title, `#3fa2c: Fix login`, for a Huddle ticket.
 */
export function ticketName(source, ticketId, title) {
  if (source === 'redmine') return `#${ticketId}`;
  const ref = huddleTicketRef(ticketId);
  return title?.trim() ? `${ref}: ${title.trim()}` : ref;
}

/** A title is user text going into markdown: its own markup must not take effect. */
function escapeMarkdown(text) {
  return text.replace(/([\\`*_[\]()<>])/g, '\\$1');
}

/**
 * The update as markdown: one italic line with the ticket linked.
 * @param {string} action one of `TimerUpdate`
 * @param {{ source: string, ticketId: string, title?: string | null }} ticket
 */
export function timerUpdateText(action, { source, ticketId, title }) {
  const name = escapeMarkdown(ticketName(source, ticketId, title));
  const link = `[${name}](${ticketPath(source, ticketId)})`;
  return `*${WORDING[action](source === 'redmine' ? `${link} ${OF_REDMINE}` : link)}*`;
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
