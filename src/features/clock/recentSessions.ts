/**
 * Grouping and totals for the Clock page's Recent sessions rail.
 *
 * A session's duration prefers the backend's own `workSeconds` — shift span
 * minus only its *deductible* (unpaid meal) breaks, per
 * meteor-backend/server/clock-core.js `computeWorkSeconds`. `totalBreakSeconds`
 * is a display-only sum across every break including paid rest breaks, so
 * subtracting it would undercount a shift that took a paid break.
 */
import type { ClockEvent } from '../../lib/api';
import { formatDate } from '../../lib/timeUtils';
import { clockText } from './clockStrings';
import { getLocalDateKey } from './timesheetUtils';

const ONE_MINUTE_SECONDS = 60;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface DayGroup {
  dateKey: string;
  sessions: ClockEvent[];
  totalSeconds: number;
}

/** A completed session's worked duration in seconds, minus its deductible breaks. */
export function getSessionDurationSeconds(session: ClockEvent): number {
  if (session.endTime == null) return 0;
  if (typeof session.workSeconds === 'number') return Math.max(0, session.workSeconds);
  const raw = Math.round((session.endTime - session.startTime) / 1000);
  return Math.max(0, raw - (session.deductedBreakSeconds ?? 0));
}

export function isUnderOneMinute(session: ClockEvent): boolean {
  return getSessionDurationSeconds(session) < ONE_MINUTE_SECONDS;
}

/** Buckets completed sessions by local calendar day, most recent day first. */
export function groupSessionsByDay(sessions: ClockEvent[]): DayGroup[] {
  const byDay = new Map<string, ClockEvent[]>();
  for (const session of sessions) {
    const key = getLocalDateKey(session.startTime);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(session);
    else byDay.set(key, [session]);
  }

  return Array.from(byDay.entries())
    .map(([dateKey, daySessions]) => {
      const sorted = [...daySessions].sort((a, b) => b.startTime - a.startTime);
      return {
        dateKey,
        sessions: sorted,
        totalSeconds: sorted.reduce((sum, s) => sum + getSessionDurationSeconds(s), 0),
      };
    })
    .sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1));
}

/** "Today · Oct 12" for today's bucket, otherwise "Wed · Oct 7", both in `locale`. */
export function formatDayGroupLabel(dateKey: string, todayKey: string, locale: string): string {
  // Parsed as local midnight, matching getLocalDateKey's own local-time basis.
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const datePart = formatDate(date, false, locale);
  if (dateKey === todayKey) return clockText.todayLabel(datePart);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date);
  return clockText.dayLabel(weekday, datePart);
}

/** A clocked-in shift's live worked seconds, keyed by when it started. */
export interface ActiveShiftTotal {
  startTime: number;
  seconds: number;
}

/**
 * Today's and the rolling-7-day total worked seconds. Every shift counts
 * whole toward the day it started — the same rule the timesheets use — so
 * an overnight shift that is still running counts toward the same day it
 * will once it is clocked out, and the totals don't jump at clock-out.
 */
export function getTodayAndLast7DaysSeconds(
  sessions: ClockEvent[],
  now: Date,
  activeShift?: ActiveShiftTotal | null,
): { todaySeconds: number; last7DaysSeconds: number } {
  const todayKey = getLocalDateKey(now.getTime());
  const windowStart = now.getTime() - SEVEN_DAYS_MS;

  const shifts: ActiveShiftTotal[] = sessions
    .filter((session) => session.endTime != null)
    .map((session) => ({
      startTime: session.startTime,
      seconds: getSessionDurationSeconds(session),
    }));
  if (activeShift) shifts.push(activeShift);

  let todaySeconds = 0;
  let last7DaysSeconds = 0;
  for (const { startTime, seconds } of shifts) {
    if (getLocalDateKey(startTime) === todayKey) todaySeconds += seconds;
    if (startTime >= windowStart) last7DaysSeconds += seconds;
  }
  return { todaySeconds, last7DaysSeconds };
}
