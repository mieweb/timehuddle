/**
 * Unit tests for client-time-core (server/client-time-core.js): the press
 * time clock in/out records.
 */
import { describe, it, expect } from 'vitest';

import {
  MAX_CLIENT_TIME_AGE_MS,
  clientTimeOrNow,
  clockStartTime,
  clockStopTime,
} from '../server/client-time-core';

const now = Date.UTC(2026, 10, 5, 15, 0);

describe('clientTimeOrNow', () => {
  it('uses a recent press time', () => {
    expect(clientTimeOrNow(now - 5 * 60_000, now)).toBe(now - 5 * 60_000);
  });

  it('ignores one older than 30 minutes', () => {
    expect(MAX_CLIENT_TIME_AGE_MS).toBe(30 * 60_000);
    expect(clientTimeOrNow(now - 31 * 60_000, now)).toBe(now);
  });

  it('takes a slightly fast clock as now, and ignores one far ahead', () => {
    expect(clientTimeOrNow(now + 10_000, now)).toBe(now);
    expect(clientTimeOrNow(now + 5 * 60_000, now)).toBe(now);
  });

  it('ignores anything that is not a number', () => {
    expect(clientTimeOrNow(undefined, now)).toBe(now);
    expect(clientTimeOrNow('2026-11-05', now)).toBe(now);
    expect(clientTimeOrNow(Number.NaN, now)).toBe(now);
  });
});

const min = 60_000;

describe('clockStartTime', () => {
  it('starts at the press time', () => {
    expect(clockStartTime(now - 10 * min, now, { lastEndTime: now - 60 * min })).toBe(now - 10 * min);
  });

  it('never overlaps the last session', () => {
    expect(clockStartTime(now - 20 * min, now, { lastEndTime: now - 5 * min })).toBe(now - 5 * min);
  });

  it('never starts before a session still open, which it closes then', () => {
    expect(clockStartTime(now - 20 * min, now, { openStartTimes: [now - 8 * min] })).toBe(now - 8 * min);
  });
});

describe('clockStopTime', () => {
  const startTime = now - 120 * min;

  it('ends at the press time', () => {
    expect(clockStopTime(now - 10 * min, now, { startTime })).toBe(now - 10 * min);
  });

  it('never ends before a break ended, an open break began, or a running timer began', () => {
    expect(clockStopTime(now - 10 * min, now, { startTime, breakTimes: [now - 4 * min] })).toBe(now - 4 * min);
    expect(clockStopTime(now - 10 * min, now, { startTime, timerStartTimes: [now - 6 * min] })).toBe(now - 6 * min);
  });

  it('never ends before the session began', () => {
    expect(clockStopTime(now - 25 * min, now, { startTime: now - 3 * min })).toBe(now - 3 * min);
  });
});
