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
import { ClockEvents } from './collections';
import { releasedTicketIds } from './carry-over-core';
import { releasePins } from './my-board';

/**
 * Unpin the checked-off tickets of a session that just ended, once: the
 * session records `carriedOverAt`, so a retry finishing an interrupted
 * clock-out leaves alone a ticket pinned again since. Never throws: a
 * carry-over that fails leaves the pins as they were and the clock-out done.
 * @param {string} userId
 * @param {{ _id: unknown, planItems?: unknown, carriedOverAt?: Date }} session the clock event, read after it was closed
 */
export async function carryOverPins(userId, session) {
  if (!session?._id || session.carriedOverAt) return;
  try {
    const ticketIds = releasedTicketIds(session.planItems);
    if (ticketIds.length) await releasePins(userId, ticketIds);
    await ClockEvents.updateAsync(session._id, { $set: { carriedOverAt: new Date() } });
  } catch (err) {
    console.error('[carry-over] unpinning checked-off tickets failed:', err);
  }
}
