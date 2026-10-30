import { describe, expect, it } from 'vitest';

import { snoozeChange } from './QuietTimeSettings';

const NOW = new Date(2026, 9, 29, 15, 30);

describe('snoozeChange', () => {
  it('snoozes for an hour from now', () => {
    expect(snoozeChange('hour', NOW)).toEqual({
      snoozeUntil: new Date(2026, 9, 29, 16, 30).toISOString(),
      snoozeUntilClockIn: false,
    });
  });

  it('snoozes until 8:00 tomorrow, local time', () => {
    expect(snoozeChange('tomorrow', NOW).snoozeUntil).toBe(
      new Date(2026, 9, 30, 8, 0).toISOString(),
    );
  });

  it('snoozes until the next clock-in', () => {
    expect(snoozeChange('clockIn', NOW)).toEqual({ snoozeUntil: null, snoozeUntilClockIn: true });
  });

  it('turns every snooze off', () => {
    expect(snoozeChange('off', NOW)).toEqual({ snoozeUntil: null, snoozeUntilClockIn: false });
  });
});
