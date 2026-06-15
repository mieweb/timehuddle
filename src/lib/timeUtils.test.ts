import { describe, expect, it } from 'vitest';

import {
  formatDuration,
  formatTimer,
  getActiveClockSeconds,
  startOfDay,
  endOfDay,
  toDateString,
} from './timeUtils';

describe('formatDuration', () => {
  it('formats hours and minutes', () => {
    expect(formatDuration(3661)).toBe('1h 1m');
    expect(formatDuration(7200)).toBe('2h 0m');
  });

  it('formats minutes only when under an hour', () => {
    expect(formatDuration(1800)).toBe('30m');
    expect(formatDuration(60)).toBe('1m');
  });

  it('returns 0m for zero or negative', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(-100)).toBe('0m');
  });
});

describe('formatTimer', () => {
  it('formats as HH:MM:SS', () => {
    expect(formatTimer(0)).toBe('00:00:00');
    expect(formatTimer(61)).toBe('00:01:01');
    expect(formatTimer(3661)).toBe('01:01:01');
    expect(formatTimer(36000)).toBe('10:00:00');
  });

  it('handles negative as 00:00:00', () => {
    expect(formatTimer(-5)).toBe('00:00:00');
  });
});

describe('getActiveClockSeconds', () => {
  it('returns 0 for null event', () => {
    expect(getActiveClockSeconds(null, Date.now())).toBe(0);
  });

  it('returns 0 for ended event', () => {
    const event = { startTime: 1000, endTime: 5000 };
    expect(getActiveClockSeconds(event, 10000)).toBe(0);
  });

  it('computes elapsed seconds for active event', () => {
    const startTime = 1000;
    const now = 61000; // 60 seconds later
    const event = { startTime, endTime: null };
    expect(getActiveClockSeconds(event, now)).toBe(60);
  });

  it('deducts completed meal break seconds from live elapsed time', () => {
    const startTime = 0;
    const now = 3600 * 1000; // 1 hour later
    const event = { startTime, endTime: null, deductedBreakSeconds: 1800 }; // 30min meal
    expect(getActiveClockSeconds(event, now)).toBe(1800); // 3600 - 1800
  });

  it('freezes at workSeconds snapshot when paused', () => {
    const event = { startTime: 0, endTime: null, isPaused: true, workSeconds: 1234 };
    expect(getActiveClockSeconds(event, Date.now())).toBe(1234);
  });

  it('returns 0 when paused with no workSeconds', () => {
    const event = { startTime: 0, endTime: null, isPaused: true };
    expect(getActiveClockSeconds(event, Date.now())).toBe(0);
  });

  it('guards against negative elapsed time (future startTime)', () => {
    const event = { startTime: 100000, endTime: null };
    expect(getActiveClockSeconds(event, 1000)).toBe(0);
  });
});

describe('startOfDay', () => {
  it('sets time to midnight', () => {
    const date = new Date(2026, 4, 15, 14, 30, 45);
    const result = startOfDay(date);
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
  });
});

describe('endOfDay', () => {
  it('sets time to 23:59:59.999', () => {
    const date = new Date(2026, 4, 15, 14, 30, 45);
    const result = endOfDay(date);
    expect(result.getHours()).toBe(23);
    expect(result.getMinutes()).toBe(59);
    expect(result.getSeconds()).toBe(59);
    expect(result.getMilliseconds()).toBe(999);
  });
});

describe('toDateString', () => {
  it('returns YYYY-MM-DD format', () => {
    const date = new Date(2026, 4, 15);
    expect(toDateString(date)).toBe('2026-05-15');
  });

  it('pads single-digit month and day', () => {
    const date = new Date(2026, 0, 5);
    expect(toDateString(date)).toBe('2026-01-05');
  });
});
