import { describe, expect, it } from 'vitest';

import { formatDuration } from '../../lib/timeUtils';
import { roundDurationSecondsForDisplay, sumRoundedDurationsForDisplay } from './timesheetUtils';

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
