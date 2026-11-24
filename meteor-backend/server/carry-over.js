/**
 * Clock-out carry-over (M5, #887): when a person ends a session, the tickets
 * they checked off in today's plan leave My Board's Pinned; the rest stay
 * pinned for the next session. Which ones is `releasedTicketIds`
 * (carry-over-core.js); this reads what it needs and unpins them.
 *
 * Called from `clockStop`, which the Clock out button, a wrap-up and a Pulse
 * wrap-up all end a session through. An automatic clock-out (agenda's
 * `stopActiveClock`) leaves the pins as they are.
 */
import { rawDb } from './collections';
import { releasedTicketIds } from './carry-over-core';
import { releasePins } from './my-board';
import { huddleTicketOf } from './session-plan';

/**
 * The Huddle ticket the user's running timer is on, or null. Read before
 * clock-out closes the timer.
 */
export async function runningHuddleTicketId(userId) {
  const running = await rawDb()
    .collection('timers')
    .findOne({ userId, endTime: null }, { projection: { workItemId: 1 } });
  return running ? huddleTicketOf(running.workItemId) : null;
}

/**
 * Unpin the checked-off tickets of a session that just ended. Never throws:
 * a carry-over that fails leaves the pins as they were and the clock-out done.
 * @param {string} userId
 * @param {{ planItems?: unknown }} session the clock event, as read before it ended
 * @param {string | null} runningTicketId
 */
export async function carryOverPins(userId, session, runningTicketId) {
  try {
    const ticketIds = releasedTicketIds(session?.planItems, runningTicketId);
    if (ticketIds.length) await releasePins(userId, ticketIds);
  } catch (err) {
    console.error('[carry-over] unpinning checked-off tickets failed:', err);
  }
}
