/**
 * Shared utilities for timesheet date-range filtering and datetime input parsing.
 * Used by both TimesheetPage (personal) and AdminTimesheetPanel (admin view).
 */

export type Preset = 'today' | 'yesterday' | '7d' | 'week' | '14d' | 'custom';

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
    case '7d': {
      const d = new Date(today);
      d.setDate(d.getDate() - 7);
      return [d, now];
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

export const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: '7 Days' },
  { key: 'week', label: 'This Week' },
  { key: '14d', label: '14 Days' },
  { key: 'custom', label: 'Custom' },
];
