import { describe, expect, it } from 'vitest';

import type { ClockEvent } from '../../lib/api';
import {
  formatDayGroupLabel,
  getSessionDurationSeconds,
  getTodayAndLast7DaysSeconds,
  groupSessionsByDay,
  isUnderOneMinute,
} from './recentSessions';

let nextId = 0;

function session(overrides: Partial<ClockEvent> & { startTime: number }): ClockEvent {
  nextId += 1;
  return {
    id: `session-${nextId}`,
    userId: 'user-1',
    teamId: 'team-1',
    accumulatedTime: 0,
    endTime: null,
    ...overrides,
  };
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('getSessionDurationSeconds', () => {
  it('prefers the backend-computed workSeconds when present', () => {
    // A paid rest break: totalBreakSeconds counts it (display only), but the
    // backend's workSeconds does not deduct it — this must not either.
    const s = session({
      startTime: 0,
      endTime: 2 * HOUR,
      totalBreakSeconds: 600,
      workSeconds: 2 * 3600,
    });
    expect(getSessionDurationSeconds(s)).toBe(2 * 3600);
  });

  it('falls back to deductedBreakSeconds, not totalBreakSeconds, without workSeconds', () => {
    // Same paid-rest-break shape, but as an older event with no workSeconds
    // snapshot: deductedBreakSeconds (unpaid-only) is the correct subtrahend.
    const s = session({
      startTime: 0,
      endTime: 2 * HOUR,
      totalBreakSeconds: 600,
      deductedBreakSeconds: 0,
    });
    expect(getSessionDurationSeconds(s)).toBe(2 * 3600);
  });

  it('subtracts deductedBreakSeconds from the span when workSeconds is absent', () => {
    const s = session({ startTime: 0, endTime: 2 * HOUR, deductedBreakSeconds: 600 });
    expect(getSessionDurationSeconds(s)).toBe(2 * 3600 - 600);
  });

  it('returns 0 for a session that is still open', () => {
    const s = session({ startTime: 0, endTime: null });
    expect(getSessionDurationSeconds(s)).toBe(0);
  });

  it('never goes negative when breaks exceed the span', () => {
    const s = session({ startTime: 0, endTime: 60 * 1000, deductedBreakSeconds: 600 });
    expect(getSessionDurationSeconds(s)).toBe(0);
  });
});

describe('isUnderOneMinute', () => {
  it('is true below 60 seconds and false at or above it', () => {
    expect(isUnderOneMinute(session({ startTime: 0, endTime: 59 * 1000 }))).toBe(true);
    expect(isUnderOneMinute(session({ startTime: 0, endTime: 60 * 1000 }))).toBe(false);
  });
});

describe('groupSessionsByDay', () => {
  it('buckets by local calendar day, most recent day first, sessions newest first', () => {
    const today = new Date(2026, 9, 12, 9, 0, 0).getTime(); // Oct 12, 2026
    const yesterdayEarly = new Date(2026, 9, 11, 9, 0, 0).getTime();
    const yesterdayLate = new Date(2026, 9, 11, 17, 0, 0).getTime();

    const groups = groupSessionsByDay([
      session({ startTime: yesterdayEarly, endTime: yesterdayEarly + HOUR }),
      session({ startTime: today, endTime: today + HOUR }),
      session({ startTime: yesterdayLate, endTime: yesterdayLate + HOUR }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].dateKey).toBe('2026-10-12');
    expect(groups[1].dateKey).toBe('2026-10-11');
    expect(groups[1].sessions.map((s) => s.startTime)).toEqual([yesterdayLate, yesterdayEarly]);
  });

  it('sums each day total from its sessions worked seconds', () => {
    const start = new Date(2026, 9, 12, 9, 0, 0).getTime();
    const groups = groupSessionsByDay([
      session({ startTime: start, endTime: start + HOUR, deductedBreakSeconds: 0 }),
      session({
        startTime: start + 2 * HOUR,
        endTime: start + 3 * HOUR,
        deductedBreakSeconds: 300,
      }),
    ]);

    expect(groups[0].totalSeconds).toBe(3600 + (3600 - 300));
  });
});

describe('formatDayGroupLabel', () => {
  it('labels the matching key "Today · <date>"', () => {
    expect(formatDayGroupLabel('2026-10-12', '2026-10-12')).toBe('Today · Oct 12');
  });

  it('labels other days with their weekday', () => {
    // 2026-10-07 is a Wednesday.
    expect(formatDayGroupLabel('2026-10-07', '2026-10-12')).toBe('Wed · Oct 7');
  });
});

describe('getTodayAndLast7DaysSeconds', () => {
  it('sums only today for todaySeconds, and the rolling 7-day window for last7DaysSeconds', () => {
    const now = new Date(2026, 9, 12, 12, 0, 0);
    const todayStart = new Date(2026, 9, 12, 9, 0, 0).getTime();
    const sixDaysAgo = now.getTime() - 6 * DAY;
    const eightDaysAgo = now.getTime() - 8 * DAY;

    const sessions = [
      session({ startTime: todayStart, endTime: todayStart + HOUR }), // today, 1h
      session({ startTime: sixDaysAgo, endTime: sixDaysAgo + HOUR }), // within window, 1h
      session({ startTime: eightDaysAgo, endTime: eightDaysAgo + HOUR }), // outside window
    ];

    const { todaySeconds, last7DaysSeconds } = getTodayAndLast7DaysSeconds(sessions, now);
    expect(todaySeconds).toBe(3600);
    expect(last7DaysSeconds).toBe(2 * 3600);
  });

  it('ignores sessions still clocked in (no endTime)', () => {
    const now = new Date(2026, 9, 12, 12, 0, 0);
    const openSession = session({ startTime: now.getTime() - HOUR, endTime: null });
    const { todaySeconds, last7DaysSeconds } = getTodayAndLast7DaysSeconds([openSession], now);
    expect(todaySeconds).toBe(0);
    expect(last7DaysSeconds).toBe(0);
  });
});

describe('getTodayAndLast7DaysSeconds — a shift still clocked in', () => {
  it('adds a running shift that started today to both totals', () => {
    const now = new Date(2026, 9, 12, 12, 0, 0);
    const startTime = new Date(2026, 9, 12, 10, 0, 0).getTime();
    const totals = getTodayAndLast7DaysSeconds([], now, { startTime, seconds: 2 * 3600 });
    expect(totals).toEqual({ todaySeconds: 2 * 3600, last7DaysSeconds: 2 * 3600 });
  });

  it('counts an overnight shift toward the day it started, before and after clock-out', () => {
    // 23:00 yesterday → 01:00 today. Like the timesheets, the whole shift
    // belongs to yesterday, so Today must not jump when it is clocked out.
    const now = new Date(2026, 9, 12, 1, 0, 0);
    const startTime = new Date(2026, 9, 11, 23, 0, 0).getTime();

    const running = getTodayAndLast7DaysSeconds([], now, { startTime, seconds: 2 * 3600 });
    const finished = getTodayAndLast7DaysSeconds(
      [session({ startTime, endTime: now.getTime(), workSeconds: 2 * 3600 })],
      now,
    );

    expect(running).toEqual({ todaySeconds: 0, last7DaysSeconds: 2 * 3600 });
    expect(finished).toEqual(running);
  });
});
