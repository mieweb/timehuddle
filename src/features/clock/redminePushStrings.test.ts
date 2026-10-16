import { describe, expect, it } from 'vitest';

import { asClock, entryDayLabel, hoursLabel } from './redminePushStrings';

describe('hoursLabel', () => {
  it('reads as time worked, or as Redmine stores it', () => {
    expect(hoursLabel(0.62, false)).toBe(asClock(0.62));
    expect(hoursLabel(0.62, false)).toBe('0:37');
    expect(hoursLabel(0.62, true)).toBe('0.62 h');
    expect(hoursLabel(2, true)).toBe('2.00 h');
  });
});

describe('entryDayLabel', () => {
  // Noon, so no timezone can move it onto a neighbouring day.
  const today = new Date(2026, 9, 12, 12);

  it('says Today for the current local day', () => {
    expect(entryDayLabel('2026-10-12', today)).toBe('Today');
  });

  it('gives another day of this year as a short date, without the year', () => {
    const label = entryDayLabel('2026-10-09', today);
    expect(label).toBe(
      new Date(2026, 9, 9).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    );
    expect(label).not.toContain('2026');
  });

  it('adds the year for a day in another year', () => {
    expect(entryDayLabel('2025-12-31', today)).toContain('2025');
  });

  it('reads the date as a local day, not as UTC midnight', () => {
    // `new Date('2026-10-12')` is UTC, which is the 11th west of Greenwich.
    expect(entryDayLabel('2026-10-12', new Date(2026, 9, 12, 0, 1))).toBe('Today');
  });

  it('hands back anything that is not a date as it came', () => {
    expect(entryDayLabel('soon', today)).toBe('soon');
  });
});
