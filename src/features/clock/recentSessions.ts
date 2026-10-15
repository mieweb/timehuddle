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

/** "Today · Oct 12" for today's bucket, otherwise "Wed · Oct 7". */
export function formatDayGroupLabel(dateKey: string, todayKey: string): string {
  // Parsed as local midnight, matching getLocalDateKey's own local-time basis.
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const dayPart = formatDate(date);
  if (dateKey === todayKey) return `Today · ${dayPart}`;
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date);
  return `${weekday} · ${dayPart}`;
}

/** Today's and the rolling-7-day total worked seconds, from completed sessions. */
export function getTodayAndLast7DaysSeconds(
  sessions: ClockEvent[],
  now: Date,
): { todaySeconds: number; last7DaysSeconds: number } {
  const todayKey = getLocalDateKey(now.getTime());
  const windowStart = now.getTime() - SEVEN_DAYS_MS;

  let todaySeconds = 0;
  let last7DaysSeconds = 0;
  for (const session of sessions) {
    if (session.endTime == null) continue;
    const duration = getSessionDurationSeconds(session);
    if (getLocalDateKey(session.startTime) === todayKey) todaySeconds += duration;
    if (session.startTime >= windowStart) last7DaysSeconds += duration;
  }
  return { todaySeconds, last7DaysSeconds };
}
