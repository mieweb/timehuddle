import { describe, expect, it } from 'vitest';

import { formatDuration } from '../../lib/timeUtils';
import type { ClockEvent } from '../../lib/api';
import {
  getSessionWorkSeconds,
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

describe('getSessionWorkSeconds', () => {
  const START = Date.UTC(2026, 9, 26, 9, 0, 0);
  const session = (fields: Partial<ClockEvent>): ClockEvent =>
    ({ id: 's', startTime: START, endTime: null, accumulatedTime: 0, ...fields }) as ClockEvent;

  it("takes a closed session's work time from the server, zero included", () => {
    const end = START + hms(1) * 1000;
    expect(getSessionWorkSeconds(session({ endTime: end, workSeconds: hms(0, 45) }), end)).toBe(
      hms(0, 45),
    );
    // All of it a meal break: no work, not the whole hour.
    expect(
      getSessionWorkSeconds(session({ endTime: end, workSeconds: 0, accumulatedTime: 0 }), end),
    ).toBe(0);
  });

  it('keeps an open session ticking past its fetched snapshot, less meal breaks', () => {
    const open = session({ workSeconds: hms(1), deductedBreakSeconds: hms(0, 30) });
    expect(getSessionWorkSeconds(open, START + hms(2) * 1000)).toBe(hms(1, 30));
    expect(getSessionWorkSeconds(open, START + hms(3) * 1000)).toBe(hms(2, 30));
  });

  it('holds an open session on break at its snapshot', () => {
    const onBreak = session({ isPaused: true, workSeconds: hms(1, 10) });
    expect(getSessionWorkSeconds(onBreak, START + hms(5) * 1000)).toBe(hms(1, 10));
  });

  it('falls back to the span for an older closed record with nothing recorded', () => {
    const end = START + hms(2) * 1000;
    expect(getSessionWorkSeconds(session({ endTime: end }), end)).toBe(hms(2));
  });
});
