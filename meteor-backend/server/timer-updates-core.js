/**
 * The wording of the automatic Huddle update a ticket timer posts when it
 * starts, switches, stops or resumes ("Working on TH-12: Fix login"), and the one
 * a change to today's plan posts ("Added TH-307 to today's plan"). Pure: no
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
  // Starting, switching to and resuming a ticket all read the same: Huddle
  // draws the stint's time beside it, ticking until it stops.
  [TimerUpdate.STARTED]: (ticket) => `Working on ${ticket}`,
  [TimerUpdate.SWITCHED]: (ticket) => `Working on ${ticket}`,
  [TimerUpdate.STOPPED]: (ticket) => `Stopped ${ticket}`,
  [TimerUpdate.RESUMED]: (ticket) => `Working on ${ticket}`,
};

/** A title is user text going into markdown: its own markup must not take effect. */
function escapeMarkdown(text) {
  return text.replace(/([\\`*_[\]()<>])/g, '\\$1');
}

/** A ticket as a link to its page, named by its label. */
function ticketLink(label) {
  return `[${escapeMarkdown(ticketName(label))}](${label.path})`;
}

/** How long a ticket was worked on: `1h 10m`, `25m`. */
export function workedFor(seconds) {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

/**
 * The update as markdown: one italic line with the ticket linked, e.g.
 * "Working on TH-2". A switch that checked the previous ticket off today's
 * plan doesn't say so: that ticket's own update shows its time, stopped.
 * @param {string} action one of `TimerUpdate`
 * @param {{ ref: string, title: string | null, path: string }} label from
 *   `huddleTicketLabel` or `redmineIssueLabel` (ticket-label.js)
 */
export function timerUpdateText(action, label) {
  return `*${WORDING[action](ticketLink(label))}*`;
}

/** What happened to an item of today's plan, each its own Huddle update (M4, #886). */
export const PlanUpdate = {
  ADDED: 'added',
  CHECKED: 'checked',
  UNCHECKED: 'unchecked',
};

const PLAN_WORDING = {
  [PlanUpdate.ADDED]: (item) => `Added ${item} to today's plan`,
  [PlanUpdate.CHECKED]: (item, time) => (time ? `Checked off ${item} at ${time}` : `Checked off ${item}`),
  [PlanUpdate.UNCHECKED]: (item) => `Unchecked ${item}`,
};

/**
 * A text item as one plain line: links (a picked @mention) show as their
 * label, so the update links no one, and its markup can't take effect.
 */
function plainItemText(text) {
  const unlinked = text.replace(/\[((?:\\.|[^\]\\])*)\]\([^)\s]*\)/g, (_, label) =>
    label.replace(/\\(.)/g, '$1'),
  );
  return escapeMarkdown(unlinked.replace(/\s+/g, ' ').trim());
}

/**
 * A plan update as markdown, one italic line.
 * @param {string} kind one of `PlanUpdate`
 * @param {{ label: object } | { text: string }} item a ticket item's label
 *   (ticket-label.js) or a text item's text
 * @param {number | null} [seconds] for a checked-off ticket, its time this session
 */
export function planUpdateText(kind, item, seconds = null) {
  const name = 'label' in item ? ticketLink(item.label) : `“${plainItemText(item.text)}”`;
  return `*${PLAN_WORDING[kind](name, seconds === null ? null : workedFor(seconds))}*`;
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
