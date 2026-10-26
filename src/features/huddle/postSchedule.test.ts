import { describe, expect, it } from 'vitest';
import {
  MAX_AHEAD_MS,
  SCHEDULE_TEXT,
  parseLocalInputValue,
  scheduleError,
  schedulePresets,
  toLocalInputValue,
} from './postSchedule';

// Wednesday, Oct 14 2026, 10:42 local.
const NOW = new Date(2026, 9, 14, 10, 42);

describe('datetime-local values', () => {
  it('round-trips a local date', () => {
    const date = new Date(2026, 9, 1, 9, 5);
    expect(toLocalInputValue(date)).toBe('2026-10-01T09:05');
    expect(parseLocalInputValue('2026-10-01T09:05')?.getTime()).toBe(date.getTime());
  });

  it('rejects malformed and impossible values', () => {
    expect(parseLocalInputValue('')).toBeNull();
    expect(parseLocalInputValue('2026-10-01')).toBeNull();
    expect(parseLocalInputValue('2026-02-30T09:00')).toBeNull();
  });
});

describe('scheduleError', () => {
  const now = NOW.getTime();

  it('needs a time', () => {
    expect(scheduleError(null, now)).toBe(SCHEDULE_TEXT.errorMissing);
  });

  it('needs at least a minute of lead', () => {
    expect(scheduleError(new Date(now + 30_000), now)).toBe(SCHEDULE_TEXT.errorPast);
    expect(scheduleError(new Date(now + 60_000), now)).toBeNull();
  });

  it('caps at a year ahead', () => {
    expect(scheduleError(new Date(now + MAX_AHEAD_MS + 1), now)).toBe(SCHEDULE_TEXT.errorTooFar);
  });
});

describe('schedulePresets', () => {
  const at = (id: string) => schedulePresets(NOW).find((p) => p.id === id)!.at;

  it('rounds an hour out up to the next five minutes', () => {
    expect(toLocalInputValue(at('hour'))).toBe('2026-10-14T11:45');
  });

  it('offers tomorrow and next Monday at 9:00', () => {
    expect(toLocalInputValue(at('tomorrow'))).toBe('2026-10-15T09:00');
    expect(toLocalInputValue(at('monday'))).toBe('2026-10-19T09:00');
  });

  it('skips to the following Monday when today is Monday', () => {
    const monday = new Date(2026, 9, 19, 8, 0);
    const next = schedulePresets(monday).find((p) => p.id === 'monday')!.at;
    expect(toLocalInputValue(next)).toBe('2026-10-26T09:00');
  });
});
