/**
 * Shared utilities for timesheet date-range filtering and datetime input parsing.
 * Used by both TimesheetPage (personal) and AdminTimesheetPanel (admin view).
 */

export type Preset = 'today' | 'yesterday' | 'lastWeek' | 'week' | '14d' | 'custom';

export function getDateRange(preset: Preset): [Date, Date] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (preset) {
    case 'today':
      return [today, now];
    case 'yesterday': {
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      return [y, new Date(today.getTime() - 1)];
    }
    case 'lastWeek': {
      // Calculate Monday of last week
      const d = new Date(today);
      const day = d.getDay();
      const diff = (day === 0 ? -6 : 1) - day;
      d.setDate(d.getDate() + diff - 7); // Go back one week from this Monday
      const lastMonday = new Date(d);
      // Calculate Sunday of last week (end of day)
      const lastSunday = new Date(d);
      lastSunday.setDate(lastSunday.getDate() + 6);
      lastSunday.setHours(23, 59, 59, 999);
      return [lastMonday, lastSunday];
    }
    case 'week': {
      const d = new Date(today);
      // Calculate Monday (ISO week start)
      const day = d.getDay();
      const diff = (day === 0 ? -6 : 1) - day; // Sunday = -6, Monday = 0, Tuesday = -1, etc.
      d.setDate(d.getDate() + diff);
      return [d, now];
    }
    case '14d': {
      const d = new Date(today);
      d.setDate(d.getDate() - 14);
      return [d, now];
    }
    default:
      return [today, now];
  }
}

/** Returns a "YYYY-MM-DD" key for the given timestamp based on the local calendar date. */
export function getLocalDateKey(epochMs: number): string {
  const d = new Date(epochMs);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
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

export const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'lastWeek', label: 'Last Week' },
  { key: 'week', label: 'This Week' },
  { key: '14d', label: '14 Days' },
  { key: 'custom', label: 'Custom' },
];
