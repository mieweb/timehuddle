/**
 * Clock-out carry-over (M5, #887): when a person ends a session, the tickets
 * they checked off in today's plan leave My Board's Pinned; the rest stay
 * pinned for the next session. Which ones is `releasedTicketIds`
 * (carry-over-core.js); this unpins them.
 *
 * Called from `clockStop`, which the Clock out button, a wrap-up and a Pulse
 * wrap-up all end a session through. An automatic clock-out (agenda's
 * `finishAutoClockOut`) leaves the pins as they are.
 */
import { releasedTicketIds } from './carry-over-core';
import { releasePins } from './my-board';

/**
 * Unpin the checked-off tickets of a session that just ended. Never throws:
 * a carry-over that fails leaves the pins as they were and the clock-out done.
 * @param {string} userId
 * @param {{ planItems?: unknown }} session the clock event
 */
export async function carryOverPins(userId, session) {
  try {
    const ticketIds = releasedTicketIds(session?.planItems);
    if (ticketIds.length) await releasePins(userId, ticketIds);
  } catch (err) {
    console.error('[carry-over] unpinning checked-off tickets failed:', err);
  }
}
