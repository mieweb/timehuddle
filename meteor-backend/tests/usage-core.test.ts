/**
 * Unit tests for usage-core (server/usage-core.js) — the arithmetic behind the
 * org usage page.
 *
 * Pure module, no Meteor and no database, so unlike the rest of this folder
 * these run without a Meteor server on 3101.
 *
 * The cases that matter are the ones that decide what an owner sees next to
 * someone's name: the cadence boundaries, and the fact that cadence reads the
 * full 30-day window while the counts only read the selected period.
 */
import { describe, it, expect } from 'vitest';
import {
  CADENCE_WINDOW_DAYS,
  FEATURE_KEYS,
  classifyCadence,
  periodStartDay,
  summarizeTotals,
  summarizeUsage,
} from '../server/usage-core';

const member = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `User ${id}`,
  email: `${id}@example.com`,
  username: id,
  image: null,
  role: 'member',
  blocked: false,
  ...overrides,
});

const bucket = (
  userId: string,
  day: string,
  feature = 'posts',
  count = 1,
  lastAt = `${day}T12:00:00.000Z`,
) => ({ feature, userId, day, count, lastAt });

describe('classifyCadence', () => {
  it('calls someone who shows up most weekdays daily', () => {
    expect(classifyCadence(22)).toBe('daily');
    expect(classifyCadence(15)).toBe('daily');
  });

  it('does not promote a once-a-week user to daily', () => {
    expect(classifyCadence(14)).toBe('weekly');
    expect(classifyCadence(4)).toBe('weekly');
  });

  it('separates biweekly from monthly and dormant', () => {
    expect(classifyCadence(3)).toBe('biweekly');
    expect(classifyCadence(2)).toBe('biweekly');
    expect(classifyCadence(1)).toBe('monthly');
    expect(classifyCadence(0)).toBe('dormant');
  });
});

describe('periodStartDay', () => {
  it('a one-day period starts today', () => {
    const now = new Date('2026-09-21T15:00:00.000Z');
    expect(periodStartDay(1, 'UTC', now)).toBe('2026-09-21');
  });

  it('a seven-day period includes today and the six days before it', () => {
    const now = new Date('2026-09-21T15:00:00.000Z');
    expect(periodStartDay(7, 'UTC', now)).toBe('2026-09-15');
  });

  it('cuts the day in the requested timezone, not UTC', () => {
    // 00:30 UTC on the 21st is still the evening of the 20th in New York.
    const now = new Date('2026-09-21T00:30:00.000Z');
    expect(periodStartDay(1, 'UTC', now)).toBe('2026-09-21');
    expect(periodStartDay(1, 'America/New_York', now)).toBe('2026-09-20');
  });
});

describe('summarizeUsage', () => {
  it('gives every member a row, including one who has done nothing', () => {
    const rows = summarizeUsage({
      members: [member('a'), member('b')],
      buckets: [bucket('a', '2026-09-20')],
      startDay: '2026-09-15',
    });

    expect(rows.map((row) => row.id)).toEqual(['a', 'b']);
    const dormant = rows.find((row) => row.id === 'b');
    expect(dormant).toMatchObject({ totalActions: 0, cadence: 'dormant', status: 'idle' });
    expect(dormant?.lastActiveAt).toBeNull();
  });

  it('counts only the selected period but classifies cadence on the whole window', () => {
    const buckets = [
      // Sixteen days of activity, all of them before the selected period.
      ...Array.from({ length: 16 }, (_, index) =>
        bucket('a', `2026-08-${String(index + 10).padStart(2, '0')}`),
      ),
      bucket('a', '2026-09-20', 'clock', 3),
    ];

    const [row] = summarizeUsage({ members: [member('a')], buckets, startDay: '2026-09-15' });

    expect(row.totalActions).toBe(3);
    expect(row.activeDays).toBe(1);
    expect(row.features.clock).toBe(3);
    expect(row.features.posts).toBe(0);
    // 17 distinct days across the window, so still a daily user.
    expect(row.cadenceActiveDays).toBe(17);
    expect(row.cadence).toBe('daily');
  });

  it('reports the most-used feature of the period and the latest action of the window', () => {
    const [row] = summarizeUsage({
      members: [member('a')],
      buckets: [
        bucket('a', '2026-09-16', 'posts', 2, '2026-09-16T09:00:00.000Z'),
        bucket('a', '2026-09-17', 'clock', 5, '2026-09-17T09:00:00.000Z'),
        // Outside the period — must not win topFeature, must still win lastActiveAt.
        bucket('a', '2026-09-01', 'tickets', 99, '2026-09-01T09:00:00.000Z'),
      ],
      startDay: '2026-09-15',
    });

    expect(row.topFeature).toBe('clock');
    expect(row.totalActions).toBe(7);
    expect(row.lastActiveAt).toBe('2026-09-17T09:00:00.000Z');
  });

  it('marks a blocked member blocked even when they were active', () => {
    const [row] = summarizeUsage({
      members: [member('a', { blocked: true })],
      buckets: [bucket('a', '2026-09-20')],
      startDay: '2026-09-15',
    });

    expect(row.status).toBe('blocked');
    expect(row.totalActions).toBe(1);
  });

  it('ignores buckets for a user who is not in the member list', () => {
    const rows = summarizeUsage({
      members: [member('a')],
      buckets: [bucket('deleted-user', '2026-09-20')],
      startDay: '2026-09-15',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].totalActions).toBe(0);
  });

  it('sorts the busiest member of the period first', () => {
    const rows = summarizeUsage({
      members: [member('quiet'), member('busy')],
      buckets: [bucket('quiet', '2026-09-20', 'posts', 1), bucket('busy', '2026-09-20', 'posts', 9)],
      startDay: '2026-09-15',
    });

    expect(rows.map((row) => row.id)).toEqual(['busy', 'quiet']);
  });
});

describe('summarizeTotals', () => {
  it('rolls the rows up into the headline counts', () => {
    const rows = summarizeUsage({
      members: [member('a'), member('b'), member('c')],
      buckets: [
        bucket('a', '2026-09-20', 'clock', 4),
        bucket('b', '2026-09-20', 'posts', 1),
      ],
      startDay: '2026-09-15',
    });

    const totals = summarizeTotals(rows);

    expect(totals.members).toBe(3);
    expect(totals.activeMembers).toBe(2);
    expect(totals.cadenceCounts).toMatchObject({ monthly: 2, dormant: 1 });
    expect(totals.featureTotals.clock).toBe(4);
    expect(totals.topFeature).toBe('clock');
  });

  it('reports no top feature when nobody has done anything', () => {
    const rows = summarizeUsage({ members: [member('a')], buckets: [], startDay: '2026-09-15' });
    const totals = summarizeTotals(rows);

    expect(totals.topFeature).toBeNull();
    expect(totals.activeMembers).toBe(0);
    expect(FEATURE_KEYS.every((key) => totals.featureTotals[key] === 0)).toBe(true);
  });
});

describe('module constants', () => {
  it('pins the cadence window the page labels its badges with', () => {
    expect(CADENCE_WINDOW_DAYS).toBe(30);
  });
});
