import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatDuration } from '../../lib/timeUtils';
import {
  getDateRange,
  getLocalDateKey,
  roundDurationSecondsForDisplay,
  sumRoundedDurationsForDisplay,
} from './timesheetUtils';

function hms(hours: number, minutes = 0, seconds = 0): number {
  return hours * 3600 + minutes * 60 + seconds;
}

describe('roundDurationSecondsForDisplay', () => {
  it('rounds to the nearest minute for display', () => {
    expect(roundDurationSecondsForDisplay(2 * 3600 + 59 * 60 + 29)).toBe(2 * 3600 + 59 * 60);
    expect(roundDurationSecondsForDisplay(2 * 3600 + 59 * 60 + 30)).toBe(3 * 3600);
  });

  it('returns 0 for null, zero, negative, or non-finite values', () => {
    expect(roundDurationSecondsForDisplay(null)).toBe(0);
    expect(roundDurationSecondsForDisplay(0)).toBe(0);
    expect(roundDurationSecondsForDisplay(-10)).toBe(0);
    expect(roundDurationSecondsForDisplay(Number.NaN)).toBe(0);
  });
});

describe('sumRoundedDurationsForDisplay', () => {
  it('matches issue #434: five 8h sessions with leftover seconds total 40h 0m', () => {
    const durations = [hms(8, 0, 12), hms(8, 0, 12), hms(8, 0, 12), hms(8, 0, 12), hms(8, 0, 12)];
    const roundThenSum = sumRoundedDurationsForDisplay(durations);
    const sumThenRound = roundDurationSecondsForDisplay(durations.reduce((a, b) => a + b, 0));

    expect(formatDuration(roundThenSum)).toBe('40h 0m');
    expect(formatDuration(sumThenRound)).toBe('40h 1m');
    expect(roundThenSum).not.toBe(sumThenRound);
  });

  it('equals the sum of individually rounded durations', () => {
    const durations = [hms(4, 15, 20), hms(2, 40, 20), hms(1, 10, 50)];
    const expected = durations.reduce(
      (sum, seconds) => sum + roundDurationSecondsForDisplay(seconds),
      0,
    );
    expect(sumRoundedDurationsForDisplay(durations)).toBe(expected);
    expect(formatDuration(expected)).toBe('8h 6m');
  });
});

describe('getDateRange (timezone-aware)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("computes today/yesterday/week boundaries in the given timezone, not the runner's own", () => {
    // 2024-01-10 is a Wednesday. Noon ET (America/New_York, EST = UTC-5).
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2024, 0, 10, 17, 0, 0)));

    const [todayStart, todayEnd] = getDateRange('today', 'America/New_York');
    expect(todayStart.getTime()).toBe(Date.UTC(2024, 0, 10, 5, 0, 0)); // 2024-01-10 00:00 EST
    expect(todayEnd.getTime()).toBe(Date.UTC(2024, 0, 10, 17, 0, 0));

    const [yStart, yEnd] = getDateRange('yesterday', 'America/New_York');
    expect(yStart.getTime()).toBe(Date.UTC(2024, 0, 9, 5, 0, 0));
    expect(yEnd.getTime()).toBe(Date.UTC(2024, 0, 10, 5, 0, 0) - 1);

    const [weekStart] = getDateRange('week', 'America/New_York');
    expect(weekStart.getTime()).toBe(Date.UTC(2024, 0, 8, 5, 0, 0)); // Monday Jan 8

    const [lastWeekStart, lastWeekEnd] = getDateRange('lastWeek', 'America/New_York');
    expect(lastWeekStart.getTime()).toBe(Date.UTC(2024, 0, 1, 5, 0, 0)); // Monday Jan 1
    expect(lastWeekEnd.getTime()).toBe(Date.UTC(2024, 0, 8, 5, 0, 0) - 1); // just before Monday Jan 8

    const [d14Start] = getDateRange('14d', 'America/New_York');
    expect(d14Start.getTime()).toBe(Date.UTC(2023, 11, 27, 5, 0, 0));
  });

  it('buckets an instant into the correct local day for the given timezone, independent of UTC date', () => {
    // 2026-06-14 19:00 UTC = 2026-06-15 00:30 IST — already the 15th in India.
    const epochMs = Date.UTC(2026, 5, 14, 19, 0, 0);
    expect(getLocalDateKey(epochMs, 'Asia/Kolkata')).toBe('2026-06-15');
    expect(getLocalDateKey(epochMs, 'UTC')).toBe('2026-06-14');
  });
});
