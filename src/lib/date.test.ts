import { describe, expect, it } from 'vitest';

import { localDateRangeKey } from './date';

describe('localDateRangeKey', () => {
  it('names a range by its calendar days, whatever the time of day', () => {
    const morning = new Date(2026, 9, 5, 8, 0).getTime();
    const night = new Date(2026, 9, 11, 23, 59).getTime();
    expect(localDateRangeKey(morning, night)).toBe('2026-10-05..2026-10-11');
  });

  it('gives the same key as the end of a range moves through the day', () => {
    const start = new Date(2026, 9, 5).getTime();
    expect(localDateRangeKey(start, new Date(2026, 9, 7, 9).getTime())).toBe(
      localDateRangeKey(start, new Date(2026, 9, 7, 17).getTime()),
    );
  });

  it('gives a new key once the range rolls over to a new day', () => {
    const start = new Date(2026, 9, 5).getTime();
    expect(localDateRangeKey(start, new Date(2026, 9, 7, 23).getTime())).not.toBe(
      localDateRangeKey(start, new Date(2026, 9, 8, 1).getTime()),
    );
  });
});
