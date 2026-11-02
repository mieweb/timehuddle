import { describe, expect, it } from 'vitest';

import type { Notification } from '../../lib/api';
import { formatDayHeading, formatReadTime, groupByDay } from './notificationTimes';

// Local times, so the tests hold in any time zone. Expected strings reuse the
// browser formatters, so they hold in any locale; what's tested is which day
// label and which parts are chosen.
const NOW = new Date(2026, 10, 2, 10, 0); // Mon Nov 2 2026, 10:00
const at = (month: number, day: number, hour: number, minute = 0, year = 2026) =>
  new Date(year, month, day, hour, minute).toISOString();
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const date = (iso: string, year?: 'numeric') =>
  new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year,
  });

describe('formatDayHeading', () => {
  it('names today and yesterday, and adds the year only when it is not this year', () => {
    expect(formatDayHeading(at(10, 2, 9), NOW)).toBe(`Today · ${date(at(10, 2, 9))}`);
    expect(formatDayHeading(at(10, 1, 23), NOW)).toBe(`Yesterday · ${date(at(10, 1, 23))}`);
    expect(formatDayHeading(at(9, 24, 7), NOW)).toBe(date(at(9, 24, 7)));
    const lastYear = at(11, 30, 7, 0, 2025);
    expect(formatDayHeading(lastYear, NOW)).toBe(date(lastYear, 'numeric'));
  });
});

describe('formatReadTime', () => {
  it('shows only the time when read the day it arrived, otherwise names the day', () => {
    const sameDay = at(10, 1, 16, 49);
    expect(formatReadTime(at(10, 1, 16, 5), sameDay, NOW)).toBe(time(sameDay));
    const today = at(10, 2, 8, 3);
    expect(formatReadTime(at(10, 1, 9, 12), today, NOW)).toBe(`Today ${time(today)}`);
    const yesterday = at(10, 1, 18, 10);
    expect(formatReadTime(at(9, 30, 9), yesterday, NOW)).toBe(`Yesterday ${time(yesterday)}`);
    const older = at(9, 30, 18, 10);
    expect(formatReadTime(at(9, 28, 9), older, NOW)).toBe(
      new Date(older).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }),
    );
  });
});

describe('groupByDay', () => {
  it('starts a new group each time the day changes, keeping the order', () => {
    const n = (id: string, createdAt: string): Notification => ({
      id,
      userId: 'u1',
      title: id,
      body: '',
      read: false,
      readAt: null,
      createdAt,
    });
    const days = groupByDay(
      [n('a', at(10, 2, 9, 41)), n('b', at(10, 2, 8)), n('c', at(10, 1, 16)), n('d', at(9, 24, 7))],
      NOW,
    );
    expect(days.map((d) => d.items.map((x) => x.id))).toEqual([['a', 'b'], ['c'], ['d']]);
    expect(days.map((d) => d.key)).toEqual(['2026-11-02', '2026-11-01', '2026-10-24']);
    expect(groupByDay([], NOW)).toEqual([]);
  });
});
