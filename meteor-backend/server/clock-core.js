/**
 * Clock core — break math + clock-stop logic shared by the `clock.*` methods
 * and the Agenda auto-clockout jobs.
 *
 * Ported verbatim from backend/src/services/clock.service.ts so accumulatedTime
 * stays byte-for-byte consistent regardless of which backend (or job) writes
 * the close-out. No Meteor method/DDP context here — plain async helpers.
 */
import { ClockEvents, ClockBreaks, rawDb } from './collections';
import { closeAllForUser } from './timer-core';

/**
 * A session can hold several posts (the plan plus replies sent from the Huddle
 * inbox). Its plan/wrap-up post is the one carrying the wrap-up, else the
 * earliest — never simply the newest, which may be an inbox reply.
 */
export const SESSION_POST_SORT = { wrapUpAt: -1, createdAt: 1 };

/**
 * Narrows a session's posts to its plan/wrap-up candidates: an update posted
 * from Huddle while clocked in joins the session (so it shows in that shift)
 * but is never its plan, nor where the wrap-up goes.
 */
export const SESSION_POST_FILTER = { sessionUpdate: { $ne: true } };

/** A clock session's Huddle post (its plan + wrap-up), or null. Drafts never count. */
export function findSessionPost(teamId, userId, clockEventId) {
  return rawDb()
    .collection('huddlePosts')
    .findOne(
      { teamId, userId, clockEventId, status: { $ne: 'draft' }, ...SESSION_POST_FILTER },
      { sort: SESSION_POST_SORT }
    );
}

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

/**
 * Stable signature of a session's break intervals.
 *
 * An approved edit replaces the break collection wholesale, so this is what a
 * change request records as its baseline: without it a pause/resume made while
 * the request sat pending leaves start/end untouched and the replay silently
 * discards the newer breaks.
 */
export function breakSignature(breaks) {
  return breaks.map((b) => `${b.startTime}-${b.endTime ?? 'open'}`).join('|');
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
  };
}

/**
 * Claim the end of the user's open clock event in a team for an automatic
 * clock-out: set endTime and accumulatedTime (span minus meal breaks) and mark
 * the event `autoClockoutPending`, so the rest (settleClosedClock, the notices)
 * can be finished later if it is interrupted. Returns the claimed event, or
 * null when nothing matched.
 *
 * `onlyIf` is a filter the event must still match at the moment it is closed.
 * The close is a single conditional write, so an answer saved meanwhile (e.g.
 * Continue Working) or a manual clock-out wins and nothing is closed or reported.
 */
export async function claimAutoClockout(userId, teamId, now, onlyIf = {}) {
  const filter = { userId, teamId, endTime: null, ...onlyIf };
  const event = await ClockEvents.findOneAsync(filter);
  if (!event) return null;

  // An open break counts the same open or closed at `now` (classifyBreak), so
  // the total can be worked out before the event is claimed.
  const breaks = await findBreaksForEvent(event._id.toHexString());
  const shiftSpan = Math.floor((now - event.startTime) / 1000);
  const accumulatedTime = Math.max(0, shiftSpan - computeDeductedBreakSeconds(breaks, now));

  const claimed = await ClockEvents.updateAsync(
    { ...filter, _id: event._id },
    { $set: { endTime: now, accumulatedTime, autoClockoutPending: true } }
  );
  if (claimed === 0) return null;
  return ClockEvents.findOneAsync(event._id);
}

/**
 * What closing a clock event leaves to do: end the user's running ticket timers
 * and any open break at the event's endTime. Safe to run again.
 */
export async function settleClosedClock(event) {
  await closeAllForUser(event.userId, event.endTime);

  const openBreak = await ClockBreaks.findOneAsync({
    clockEventId: event._id.toHexString(),
    endTime: null,
  });
  if (openBreak) {
    const durationSeconds = Math.floor((event.endTime - openBreak.startTime) / 1000);
    await ClockBreaks.updateAsync(openBreak._id, {
      $set: { endTime: event.endTime, ...classifyBreak(durationSeconds) },
    });
  }
}
