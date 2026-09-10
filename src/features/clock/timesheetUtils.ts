/**
 * Shared utilities for timesheet date-range filtering and datetime input parsing.
 * Used by both TimesheetPage (personal) and AdminTimesheetPanel (admin view).
 */
import { getLocalDayBoundary, getLocalDateKey as sharedGetLocalDateKey } from '@timehuddle/date-tz';
import { clientTz } from '../../lib/api';

export type Preset = 'today' | 'yesterday' | 'lastWeek' | 'week' | '14d' | 'custom';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * The day boundary `dayOffset` calendar days from the one containing
 * `epochMs`, in `timeZone`. Steps by an approximate 24h multiple and snaps
 * to the real boundary — safe even across a DST transition, since a
 * transition shifts the clock by at most a couple of hours, nowhere near a
 * full day, for the day ranges used here (at most ~3 weeks).
 */
function shiftedLocalDay(epochMs: number, dayOffset: number, timeZone: string) {
  return getLocalDayBoundary(epochMs + dayOffset * DAY_MS, timeZone);
}

/** 0 (Sun) – 6 (Sat) for `epochMs`, as measured in `timeZone`. */
function zonedDayOfWeek(epochMs: number, timeZone: string): number {
  const short = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(epochMs);
  return WEEKDAYS.indexOf(short);
}

/**
 * Day boundaries are computed in `timeZone` — the viewer's own timezone by
 * default, or an explicit one (e.g. the timesheet owner's saved timezone) —
 * so a shift is never attributed to the wrong calendar day just because of
 * where the browser happens to be. See packages/date-tz.
 */
export function getDateRange(preset: Preset, timeZone: string = clientTz()): [Date, Date] {
  const now = new Date();
  const { startMs: todayStartMs } = getLocalDayBoundary(now.getTime(), timeZone);
  const today = new Date(todayStartMs);

  switch (preset) {
    case 'today':
      return [today, now];
    case 'yesterday': {
      const { startMs, endMs } = shiftedLocalDay(todayStartMs, -1, timeZone);
      return [new Date(startMs), new Date(endMs - 1)];
    }
    case 'lastWeek': {
      const day = zonedDayOfWeek(todayStartMs, timeZone);
      const diff = (day === 0 ? -6 : 1) - day; // offset back to this week's Monday
      const monday = shiftedLocalDay(todayStartMs, diff - 7, timeZone);
      const sunday = shiftedLocalDay(monday.startMs, 6, timeZone);
      return [new Date(monday.startMs), new Date(sunday.endMs - 1)];
    }
    case 'week': {
      const day = zonedDayOfWeek(todayStartMs, timeZone);
      const diff = (day === 0 ? -6 : 1) - day; // Sunday = -6, Monday = 0, Tuesday = -1, etc.
      const monday = shiftedLocalDay(todayStartMs, diff, timeZone);
      return [new Date(monday.startMs), now];
    }
    case '14d': {
      const start = shiftedLocalDay(todayStartMs, -14, timeZone);
      return [new Date(start.startMs), now];
    }
    default:
      return [today, now];
  }
}

/** Returns a "YYYY-MM-DD" key for the given timestamp, measured in `timeZone`. */
export function getLocalDateKey(epochMs: number, timeZone: string = clientTz()): string {
  return sharedGetLocalDateKey(epochMs, timeZone);
}

export function toLocalDateTimeInputValue(epochMs: number): string {
  const d = new Date(epochMs);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

export function fromLocalDateTimeInputValue(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Round a second-based duration to the nearest whole minute for display.
 *
 * Timesheet timestamps are shown at minute precision, so durations should
 * follow the same rounding rule to avoid off-by-one-minute displays.
 */
export function roundDurationSecondsForDisplay(totalSeconds: number | null): number {
  const value = typeof totalSeconds === 'number' ? totalSeconds : 0;
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value / 60) * 60;
}

/** Round each duration to the nearest minute, then sum — matches visible row totals. */
export function sumRoundedDurationsForDisplay(durationsSeconds: number[]): number {
  return durationsSeconds.reduce(
    (sum, seconds) => sum + roundDurationSecondsForDisplay(seconds),
    0,
  );
}

export const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'lastWeek', label: 'Last Week' },
  { key: 'week', label: 'This Week' },
  { key: '14d', label: '14 Days' },
  { key: 'custom', label: 'Custom' },
];
