import { describe, expect, it } from 'vitest';

import { roundDurationSecondsForDisplay } from './timesheetUtils';

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
