/**
 * Times shown in the Notifications inbox (#804): rows are grouped under a day
 * heading, so each row only needs the time it arrived and, once read, when.
 * Formatting follows the browser's locale.
 */
import type { Notification } from '../../lib/api';

const LABELS = { today: 'Today', yesterday: 'Yesterday' };

const TIME: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };

function startOfDay(date: Date): Date {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

/** Calendar days between `date` and `now` (0 = same day). Rounds across DST changes. */
function daysBefore(date: Date, now: Date): number {
  return Math.round((startOfDay(now).getTime() - startOfDay(date).getTime()) / 86_400_000);
}

function yearIfNotCurrent(date: Date, now: Date): 'numeric' | undefined {
  return date.getFullYear() === now.getFullYear() ? undefined : 'numeric';
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
  const days = daysBefore(date, now);
  if (days === 0) return `${LABELS.today} · ${label}`;
  if (days === 1) return `${LABELS.yesterday} · ${label}`;
  return label;
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
  const time = read.toLocaleTimeString(undefined, TIME);
  if (daysBefore(read, new Date(createdAt)) === 0) return time;
  const days = daysBefore(read, now);
  if (days === 0) return `${LABELS.today} ${time}`;
  if (days === 1) return `${LABELS.yesterday} ${time}`;
  return read.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: yearIfNotCurrent(read, now),
    ...TIME,
  });
}

export interface NotificationDay {
  /** Local calendar day, "2026-11-02"; safe to use in an element id. */
  key: string;
  heading: string;
  items: Notification[];
}

/** Splits the inbox (already newest first) into one group per day it arrived. */
export function groupByDay(notifications: Notification[], now = new Date()): NotificationDay[] {
  const days: NotificationDay[] = [];
  for (const n of notifications) {
    const created = new Date(n.createdAt);
    const key = [
      created.getFullYear(),
      String(created.getMonth() + 1).padStart(2, '0'),
      String(created.getDate()).padStart(2, '0'),
    ].join('-');
    const last = days[days.length - 1];
    if (last?.key === key) last.items.push(n);
    else days.push({ key, heading: formatDayHeading(n.createdAt, now), items: [n] });
  }
  return days;
}
