/**
 * Clock-out carry-over (M5, #887): which of the session's plan items leave
 * My Board's Pinned when the session ends. A ticket checked off in today's
 * plan is done with for now, so it goes back to Rest of my board; one not
 * checked, or the one still running when the person clocks out, stays pinned
 * for the next session.
 *
 * The plan is M4's session data (`clockevents.planItems`, #886): items
 * `{ id, ticketId?, text?, checked }`. A session without one releases nothing.
 *
 * Pure: no Meteor, no database, so it is unit-tested directly.
 */

/**
 * The ids of the tickets to unpin: each ticket item checked off, once, in plan
 * order, but not the ticket running at clock-out.
 * @param {unknown} planItems the session's `planItems`
 * @param {string | null} [runningTicketId] the ticket timed when the session ended
 * @returns {string[]}
 */
export function releasedTicketIds(planItems, runningTicketId = null) {
  if (!Array.isArray(planItems)) return [];
  const released = new Set();
  for (const item of planItems) {
    const ticketId = item?.ticketId;
    if (item?.checked !== true || typeof ticketId !== 'string' || !ticketId) continue;
    if (ticketId === runningTicketId) continue;
    released.add(ticketId);
  }
  return [...released];
}
