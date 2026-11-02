import { describe, expect, it } from 'vitest';

import type { Notification } from '../../lib/api';
import {
  formatDayHeading,
  formatReadTime,
  formatReceivedTime,
  groupByDay,
} from './notificationTimes';

// Local times, so the tests hold in any time zone. Expected strings reuse the
// browser formatters, so they hold in any locale; what's tested is which day
// label and which parts are chosen.
const NOW = new Date(2026, 10, 2, 10, 0); // Mon Nov 2 2026, 10:00
const at = (month: number, day: number, hour: number, minute = 0, year = 2026) =>
  new Date(year, month, day, hour, minute).toISOString();

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const dayLabel = (iso: string, year?: 'numeric') =>
  new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year,
  });

function notification(id: string, createdAt: string): Notification {
  return { id, userId: 'u1', title: id, body: '', read: false, readAt: null, createdAt };
}

describe('formatDayHeading', () => {
  it('prefixes today and yesterday', () => {
    expect(formatDayHeading(at(10, 2, 9), NOW)).toBe(`Today · ${dayLabel(at(10, 2, 9))}`);
    expect(formatDayHeading(at(10, 1, 23), NOW)).toBe(`Yesterday · ${dayLabel(at(10, 1, 23))}`);
  });

  it('shows only the date for older days, with the year when it is not this year', () => {
    expect(formatDayHeading(at(9, 24, 7), NOW)).toBe(dayLabel(at(9, 24, 7)));
    const lastYear = at(11, 30, 7, 0, 2025);
    expect(formatDayHeading(lastYear, NOW)).toBe(dayLabel(lastYear, 'numeric'));
  });
});

describe('formatReceivedTime', () => {
  it('shows only the time', () => {
    expect(formatReceivedTime(at(10, 2, 15, 14))).toBe(time(at(10, 2, 15, 14)));
  });
});

describe('formatReadTime', () => {
  it('shows only the time when read the day it arrived', () => {
    const readAt = at(10, 1, 16, 49);
    expect(formatReadTime(at(10, 1, 16, 5), readAt, NOW)).toBe(time(readAt));
  });

  it('names today or yesterday when read on a later day', () => {
    const today = at(10, 2, 8, 3);
    expect(formatReadTime(at(10, 1, 9, 12), today, NOW)).toBe(`Today ${time(today)}`);
    const yesterday = at(10, 1, 18, 10);
    expect(formatReadTime(at(9, 30, 9), yesterday, NOW)).toBe(`Yesterday ${time(yesterday)}`);
  });

  it('shows the date for older reads', () => {
    const readAt = at(9, 30, 18, 10);
    const expected = new Date(readAt).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    expect(formatReadTime(at(9, 28, 9), readAt, NOW)).toBe(expected);
  });
});

describe('groupByDay', () => {
  it('starts a new group each time the day changes, keeping the order', () => {
    const days = groupByDay(
      [
        notification('a', at(10, 2, 9, 41)),
        notification('b', at(10, 2, 8)),
        notification('c', at(10, 1, 16, 5)),
        notification('d', at(9, 24, 7)),
      ],
      NOW,
    );
    expect(days.map((d) => d.items.map((n) => n.id))).toEqual([['a', 'b'], ['c'], ['d']]);
    expect(days.map((d) => d.key)).toEqual(['2026-11-02', '2026-11-01', '2026-10-24']);
    expect(days[0].heading).toBe(formatDayHeading(at(10, 2, 9, 41), NOW));
  });

  it('returns no groups for an empty inbox', () => {
    expect(groupByDay([], NOW)).toEqual([]);
  });
});
