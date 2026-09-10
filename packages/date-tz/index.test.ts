import { describe, it, expect } from 'vitest';
import { getLocalDayBoundary, getLocalDateKey } from './index.js';

const HOUR = 60 * 60 * 1000;
const NY = 'America/New_York';
const KOLKATA = 'Asia/Kolkata';

describe('getLocalDayBoundary / getLocalDateKey', () => {
  it('buckets a normal mid-afternoon instant to the expected local day', () => {
    // 2026-06-15 15:00 UTC = 11:00 EDT (UTC-4) on the same calendar day.
    const epochMs = Date.UTC(2026, 5, 15, 15, 0, 0);
    expect(getLocalDateKey(epochMs, NY)).toBe('2026-06-15');

    const { startMs, endMs } = getLocalDayBoundary(epochMs, NY);
    expect(startMs).toBe(Date.UTC(2026, 5, 15, 4, 0, 0)); // 2026-06-15 00:00 EDT
    expect(endMs).toBe(Date.UTC(2026, 5, 16, 4, 0, 0)); // 2026-06-16 00:00 EDT
  });

  it('does not roll to the next local day just because UTC already has', () => {
    // 2026-06-15 02:00 UTC = 2026-06-14 22:00 EDT — UTC says the 15th, ET still says the 14th.
    const epochMs = Date.UTC(2026, 5, 15, 2, 0, 0);
    expect(getLocalDateKey(epochMs, NY)).toBe('2026-06-14');
  });

  it('rolls to the next local day even though UTC has not yet', () => {
    // 2026-06-14 19:00 UTC = 2026-06-15 00:30 IST — IST is already on the 15th, UTC still on the 14th.
    const epochMs = Date.UTC(2026, 5, 14, 19, 0, 0);
    expect(getLocalDateKey(epochMs, KOLKATA)).toBe('2026-06-15');
    expect(getLocalDateKey(epochMs, 'UTC')).toBe('2026-06-14');
  });

  it('produces a 23-hour day across a spring-forward transition', () => {
    // America/New_York springs forward on 2026-03-08 (2am EST -> 3am EDT).
    const epochMs = Date.UTC(2026, 2, 8, 16, 0, 0); // noon EDT, well inside the day
    const { startMs, endMs } = getLocalDayBoundary(epochMs, NY);
    expect(endMs - startMs).toBe(23 * HOUR);
  });

  it('produces a 25-hour day across a fall-back transition', () => {
    // America/New_York falls back on 2026-11-01 (2am EDT -> 1am EST).
    const epochMs = Date.UTC(2026, 10, 1, 17, 0, 0); // noon EST, well inside the day
    const { startMs, endMs } = getLocalDayBoundary(epochMs, NY);
    expect(endMs - startMs).toBe(25 * HOUR);
  });

  it('falls back to UTC for a missing or invalid timezone, without throwing', () => {
    const epochMs = Date.UTC(2026, 5, 15, 15, 0, 0);
    expect(getLocalDateKey(epochMs, undefined)).toBe('2026-06-15');
    expect(getLocalDateKey(epochMs, 'Not/ARealZone')).toBe('2026-06-15');

    const utcBoundary = getLocalDayBoundary(epochMs, 'UTC');
    const invalidBoundary = getLocalDayBoundary(epochMs, 'Not/ARealZone');
    expect(invalidBoundary).toEqual(utcBoundary);
  });
});
