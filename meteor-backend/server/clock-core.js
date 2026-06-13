/**
 * Clock core — break math + clock-stop logic shared by the `clock.*` methods
 * and the Agenda auto-clockout jobs.
 *
 * Ported verbatim from backend/src/services/clock.service.ts so accumulatedTime
 * stays byte-for-byte consistent regardless of which backend (or job) writes
 * the close-out. No Meteor method/DDP context here — plain async helpers.
 */
import { ClockEvents, ClockBreaks } from './collections';

/** 20-minute threshold: breaks >= this are non-compensable meal breaks (deducted). */
export const MEAL_BREAK_THRESHOLD_SECONDS = 20 * 60;

/** Auto-classify a break by duration (mirrors ClockService). */
export function classifyBreak(durationSeconds) {
  return {
    type: durationSeconds >= MEAL_BREAK_THRESHOLD_SECONDS ? 'meal' : 'rest',
    classificationSource: 'auto',
  };
}

/** Mirror of computeDeductedBreakSeconds in backend clock.service.ts. */
export function computeDeductedBreakSeconds(breaks, now) {
  return breaks.reduce((sum, b) => {
    const end = typeof b.endTime === 'number' ? b.endTime : now;
    if (end <= b.startTime) return sum;
    const durationSeconds = Math.floor((end - b.startTime) / 1000);
    if (typeof b.endTime === 'number') {
      return b.type === 'rest' ? sum : sum + durationSeconds;
    }
    return durationSeconds >= MEAL_BREAK_THRESHOLD_SECONDS ? sum + durationSeconds : sum;
  }, 0);
}

/**
 * Net work seconds for a shift: full span minus deducted (meal) break seconds.
 * Mirror of computeWorkSeconds in backend clock.service.ts.
 */
export function computeWorkSeconds(event, breaks, now) {
  const shiftEnd = typeof event.endTime === 'number' ? event.endTime : now;
  const shiftSpan = Math.max(0, Math.floor((shiftEnd - event.startTime) / 1000));
  return Math.max(0, shiftSpan - computeDeductedBreakSeconds(breaks, now));
}

/** Load all breaks for a clock event, ordered by startTime (mirror of model helper). */
export function findBreaksForEvent(clockEventId) {
  return ClockBreaks.find({ clockEventId }, { sort: { startTime: 1 } }).fetchAsync();
}

/** Shape a stored clock event doc into the DDP/API form (hex id). */
export function toPublicEvent(doc) {
  const { _id, ...rest } = doc;
  return { id: _id.toHexString ? _id.toHexString() : String(_id), ...rest };
}

/**
 * Close the user's active clock event in a team: auto-classify any open break,
 * compute accumulatedTime (span minus meal breaks), and set endTime. Returns the
 * updated event doc, or null when there was nothing open. Mirrors ClockService.stop.
 */
export async function stopActiveClock(userId, teamId, now = Date.now()) {
  const event = await ClockEvents.findOneAsync({ userId, teamId, endTime: null });
  if (!event) return null;

  const eventId = event._id.toHexString();

  const openBreak = await ClockBreaks.findOneAsync({ clockEventId: eventId, endTime: null });
  if (openBreak) {
    const durationSeconds = Math.floor((now - openBreak.startTime) / 1000);
    await ClockBreaks.updateAsync(openBreak._id, {
      $set: { endTime: now, ...classifyBreak(durationSeconds) },
    });
  }

  const breaks = await findBreaksForEvent(eventId);
  const shiftSpan = Math.floor((now - event.startTime) / 1000);
  const deducted = computeDeductedBreakSeconds(breaks, now);
  const accumulatedTime = Math.max(0, shiftSpan - deducted);

  await ClockEvents.updateAsync(event._id, { $set: { endTime: now, accumulatedTime } });
  return ClockEvents.findOneAsync(event._id);
}
