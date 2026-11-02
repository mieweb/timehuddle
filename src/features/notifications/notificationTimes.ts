/**
 * Times shown in the Notifications inbox (#804): rows are grouped under a day
 * heading, so each row only needs the time it arrived and, once read, when.
 * Formatting follows the browser's locale.
 */
import type { Notification } from '../../lib/api';

const TIME: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };

/** Local calendar day as "2026-11-02"; safe to use in an element id. */
const dayKey = (date: Date) => date.toLocaleDateString('en-CA');

const yearIfNotCurrent = (date: Date, now: Date) =>
  date.getFullYear() === now.getFullYear() ? undefined : 'numeric';

/** "Today" or "Yesterday" relative to `now`; counts calendar days, so DST can't skew it. */
function nearDay(date: Date, now: Date): string | undefined {
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = (day(now) - day(date)) / 86_400_000;
  return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : undefined;
}

/** "Today · Mon, Nov 2", "Yesterday · Sun, Nov 1", or "Sat, Oct 24". */
export function formatDayHeading(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const label = date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: yearIfNotCurrent(date, now),
  });
  const near = nearDay(date, now);
  return near ? `${near} · ${label}` : label;
}

/** "3:14 PM" — the day comes from the heading above the row. */
export function formatReceivedTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, TIME);
}

/**
 * When it was read, as short as the row allows: just the time if read the day it
 * arrived, otherwise "Today 8:03 AM", "Yesterday 6:10 PM" or "Oct 30, 6:10 PM".
 */
export function formatReadTime(createdAt: string, readAt: string, now = new Date()): string {
  const read = new Date(readAt);
  if (dayKey(read) === dayKey(new Date(createdAt))) return formatReceivedTime(readAt);
  const near = nearDay(read, now);
  if (near) return `${near} ${formatReceivedTime(readAt)}`;
  return read.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: yearIfNotCurrent(read, now),
    ...TIME,
  });
}

export interface NotificationDay {
  key: string;
  heading: string;
  items: Notification[];
}

/** Splits the inbox (already newest first) into one group per day it arrived. */
export function groupByDay(notifications: Notification[], now = new Date()): NotificationDay[] {
  const days: NotificationDay[] = [];
  for (const n of notifications) {
    const key = dayKey(new Date(n.createdAt));
    const last = days[days.length - 1];
    if (last?.key === key) last.items.push(n);
    else days.push({ key, heading: formatDayHeading(n.createdAt, now), items: [n] });
  }
  return days;
}
