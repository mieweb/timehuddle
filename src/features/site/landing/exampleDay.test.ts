import { describe, expect, it } from 'vitest';

import {
  EXAMPLE_DAY,
  formatClock,
  formatDuration,
  redmineSummary,
  runningSessionAt,
  shiftMinutesAt,
  ticketMinutesAt,
} from './exampleDay';

describe('example day', () => {
  it('excludes the meal break from the shift clock', () => {
    // 08:52 → 17:34 is 522 minutes; the 35-minute break comes off.
    expect(shiftMinutesAt(EXAMPLE_DAY, 24 * 60)).toBe(522 - 35);
  });

  it('never lets ticket time exceed shift time', () => {
    for (let now = 8 * 60; now <= 18 * 60; now += 5) {
      expect(ticketMinutesAt(EXAMPLE_DAY, now)).toBeLessThanOrEqual(
        shiftMinutesAt(EXAMPLE_DAY, now),
      );
    }
  });

  it('keeps every ticket session inside the shift and outside breaks', () => {
    for (const s of EXAMPLE_DAY.sessions) {
      expect(s.start).toBeGreaterThanOrEqual(EXAMPLE_DAY.shift.start);
      expect(s.end).toBeLessThanOrEqual(EXAMPLE_DAY.shift.end);
      for (const b of EXAMPLE_DAY.breaks) {
        expect(s.end <= b.start || s.start >= b.end).toBe(true);
      }
    }
  });

  it('finds the running session, and none during the break', () => {
    expect(runningSessionAt(EXAMPLE_DAY, 9 * 60 + 30)?.ref).toBe('#3fa2c');
    expect(runningSessionAt(EXAMPLE_DAY, 12 * 60 + 45)).toBeUndefined();
  });

  it('sends only Redmine issues, one row per issue', () => {
    expect(redmineSummary(EXAMPLE_DAY)).toEqual([
      { ref: '#2217', title: 'Overtime report for payroll', minutes: 98 + 95 },
      { ref: '#2240', title: 'Holiday calendar import', minutes: 65 },
    ]);
  });

  it('formats durations and clock times', () => {
    expect(formatDuration(527)).toBe('8:47');
    expect(formatDuration(5)).toBe('0:05');
    expect(formatClock(532)).toBe('08:52');
  });
});
