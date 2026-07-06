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

/** Total break seconds across all breaks (display only). Mirror of clock.service.ts. */
export function computeTotalBreakSeconds(breaks, now) {
  return breaks.reduce((sum, b) => {
    const end = typeof b.endTime === 'number' ? b.endTime : now;
    if (end <= b.startTime) return sum;
    return sum + Math.floor((end - b.startTime) / 1000);
  }, 0);
}

/** Load all breaks for a clock event, ordered by startTime (mirror of model helper). */
export function findBreaksForEvent(clockEventId) {
  return ClockBreaks.find({ clockEventId }, { sort: { startTime: 1 } }).fetchAsync();
}

/** Load breaks for many clock events in one query (mirror of findBreaksForEvents). */
export function findBreaksForEvents(clockEventIds) {
  if (!clockEventIds.length) return Promise.resolve([]);
  return ClockBreaks.find(
    { clockEventId: { $in: clockEventIds } },
    { sort: { startTime: 1 } }
  ).fetchAsync();
}

/**
 * Parse raw break input into typed interval entries. Mirror of toBreakEntries.
 * Strips invalid entries, sorts by startTime.
 */
export function toBreakEntries(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const startTime = entry.startTime;
      if (typeof startTime !== 'number') return null;
      const endTime = typeof entry.endTime === 'number' ? entry.endTime : null;
      const type = entry.type === 'rest' || entry.type === 'meal' ? entry.type : undefined;
      const classificationSource =
        entry.classificationSource === 'auto' || entry.classificationSource === 'manual'
          ? entry.classificationSource
          : undefined;
      const notes = typeof entry.notes === 'string' ? entry.notes : undefined;
      const updatedBy = typeof entry.updatedBy === 'string' ? entry.updatedBy : undefined;
      const updatedAt = typeof entry.updatedAt === 'number' ? entry.updatedAt : undefined;
      return { startTime, endTime, type, classificationSource, notes, updatedBy, updatedAt };
    })
    .filter((e) => e !== null)
    .sort((a, b) => a.startTime - b.startTime);
}

/**
 * Clip break intervals to the session window and merge overlaps.
 * Mirror of normalizeBreakEntries in clock.service.ts.
 */
export function normalizeBreakEntries(breaks, sessionStart, sessionEnd) {
  const clipped = breaks
    .map((b) => {
      const start = Math.max(sessionStart, b.startTime);
      const endCap = sessionEnd ?? null;
      const rawEnd = b.endTime;
      const end =
        typeof rawEnd === 'number' ? (endCap === null ? rawEnd : Math.min(rawEnd, endCap)) : endCap;
      if (sessionEnd !== null && start >= sessionEnd) return null;
      if (typeof end === 'number' && end <= sessionStart) return null;
      if (typeof end === 'number' && end <= start) return null;
      return { ...b, startTime: start, endTime: end };
    })
    .filter((b) => b !== null)
    .sort((a, b) => a.startTime - b.startTime);

  if (!clipped.length) return [];
  const merged = [];
  for (const current of clipped) {
    const prev = merged[merged.length - 1];
    if (!prev) {
      merged.push({ ...current });
      continue;
    }
    const prevEnd = prev.endTime;
    const currEnd = current.endTime;
    const overlap = prevEnd === null || current.startTime <= prevEnd;
    if (!overlap) {
      merged.push({ ...current });
      continue;
    }
    if (prevEnd === null) continue;
    if (currEnd === null) {
      prev.endTime = null;
      continue;
    }
    prev.endTime = Math.max(prevEnd, currEnd);
  }
  return merged;
}

function hexId(id) {
  return id && id.toHexString ? id.toHexString() : String(id);
}

/** Shape a stored clock event doc into the DDP/API form (hex id). */
export function toPublicEvent(doc) {
  const { _id, ...rest } = doc;
  return { id: hexId(_id), ...rest };
}

/**
 * Rich public clock-event shape consumed by the frontend clockApi.
 * Mirror of toPublicClockEvent in backend clock.service.ts.
 */
export function toPublicClockEvent(event, breaks) {
  const startTime = typeof event.startTime === 'number' ? event.startTime : 0;
  const rawEndTime = event.endTime;
  const endTime =
    rawEndTime instanceof Date
      ? rawEndTime.getTime()
      : typeof rawEndTime === 'number'
        ? rawEndTime
        : null;

  const isPaused = breaks.some((b) => b.endTime === null);
  const now = Date.now();
  const workSeconds = computeWorkSeconds({ startTime, endTime }, breaks, now);
  const deductedBreakSeconds = computeDeductedBreakSeconds(breaks, now);
  const totalBreakSeconds = computeTotalBreakSeconds(breaks, now);

  const publicBreaks = breaks.map((b) => ({
    startTime: b.startTime,
    endTime: b.endTime,
    type: b.type,
    classificationSource: b.classificationSource,
    notes: b.notes,
    updatedBy: b.updatedBy,
    updatedAt: b.updatedAt,
  }));

  return {
    id: hexId(event._id),
    userId: event.userId,
    teamId: event.teamId,
    startTime,
    accumulatedTime: event.accumulatedTime,
    breaks: publicBreaks,
    workSeconds,
    deductedBreakSeconds,
    totalBreakSeconds,
    isPaused,
    endTime,
    shiftReminderResponse: event.shiftReminderResponse ?? null,
    shiftAutoClockoutWorkSecs: event.shiftAutoClockoutWorkSecs ?? null,
    shiftNextReminderWorkSecs: event.shiftNextReminderWorkSecs ?? null,
  };
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
