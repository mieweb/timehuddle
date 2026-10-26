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
/** Today plus the six calendar days before it. */
const LAST_7_DAYS_SPAN = 7;

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

/**
 * The first day key of the "Last 7 days" window: today and the six calendar
 * days before it. Both the status-line total and the Recent sessions table
 * use it, so the two always cover the same days. Calendar days rather than a
 * rolling 168 hours, so a row the table shows is never half in the total.
 */
export function getLast7DaysStartKey(now: Date): string {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (LAST_7_DAYS_SPAN - 1));
  return getLocalDateKey(start.getTime());
}

/** The day groups inside the "Last 7 days" window, most recent day first. */
export function groupLast7DaysByDay(sessions: ClockEvent[], now: Date): DayGroup[] {
  const startKey = getLast7DaysStartKey(now);
  return groupSessionsByDay(sessions).filter((group) => group.dateKey >= startKey);
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

/** A shift not (yet) in the completed list — running, or just clocked out — keyed by when it started. */
export interface ActiveShiftTotal {
  startTime: number;
  seconds: number;
}

/**
 * Today's and the last 7 days' total worked seconds (see
 * `getLast7DaysStartKey`). Every shift counts whole toward the day it
 * started — the same rule the timesheets use — so an overnight shift that is
 * still running counts toward the same day it will once it is clocked out,
 * and the totals don't jump at clock-out.
 */
export function getTodayAndLast7DaysSeconds(
  sessions: ClockEvent[],
  now: Date,
  extraShifts: ActiveShiftTotal[] = [],
): { todaySeconds: number; last7DaysSeconds: number } {
  const todayKey = getLocalDateKey(now.getTime());
  const windowStartKey = getLast7DaysStartKey(now);

  const shifts: ActiveShiftTotal[] = sessions
    .filter((session) => session.endTime != null)
    .map((session) => ({
      startTime: session.startTime,
      seconds: getSessionDurationSeconds(session),
    }));
  shifts.push(...extraShifts);

  let todaySeconds = 0;
  let last7DaysSeconds = 0;
  for (const { startTime, seconds } of shifts) {
    const dayKey = getLocalDateKey(startTime);
    if (dayKey === todayKey) todaySeconds += seconds;
    if (dayKey >= windowStartKey) last7DaysSeconds += seconds;
  }
  return { todaySeconds, last7DaysSeconds };
}
