/**
 * Times shown in the Notifications inbox (#804): rows are grouped under a day
 * heading, so each row only needs the time it arrived and, once read, when.
 * Formatting follows the browser's locale.
 */
import { useEffect, useState } from 'react';

import type { Notification } from '../../lib/api';
import { NOTIFICATION_STRINGS } from './notificationCopy';

const TIME: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };

/** Local calendar day as "2026-11-02"; safe to use in an element id. */
const dayKey = (date: Date) => date.toLocaleDateString('en-CA');

/**
 * Today's date, replaced once the calendar day changes, so "Today"/"Yesterday"
 * stay right on a page left open overnight. Also checked when the tab or app
 * comes back, since a background timer may not fire on time.
 */
export function useToday(): Date {
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    const check = () =>
      setToday((prev) => (dayKey(prev) === dayKey(new Date()) ? prev : new Date()));
    const midnight = new Date(today);
    midnight.setHours(24, 0, 1, 0);
    const timer = setTimeout(check, midnight.getTime() - Date.now());
    document.addEventListener('visibilitychange', check);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, [today]);
  return today;
}

const yearIfNotCurrent = (date: Date, now: Date) =>
  date.getFullYear() === now.getFullYear() ? undefined : 'numeric';

/** "Today" or "Yesterday" relative to `now`; counts calendar days, so DST can't skew it. */
function nearDay(date: Date, now: Date): string | undefined {
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = (day(now) - day(date)) / 86_400_000;
  if (days === 0) return NOTIFICATION_STRINGS.today;
  return days === 1 ? NOTIFICATION_STRINGS.yesterday : undefined;
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

/** Splits the inbox into one group per day it arrived, newest first. */
export function groupByDay(notifications: Notification[], now = new Date()): NotificationDay[] {
  // Sorted here because live arrivals are prepended, and one can be an older row the
  // capped feed backfilled; unsorted, its day would appear twice.
  const newestFirst = [...notifications].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
  const days: NotificationDay[] = [];
  for (const n of newestFirst) {
    const key = dayKey(new Date(n.createdAt));
    const last = days[days.length - 1];
    if (last?.key === key) last.items.push(n);
    else days.push({ key, heading: formatDayHeading(n.createdAt, now), items: [n] });
  }
  return days;
}
