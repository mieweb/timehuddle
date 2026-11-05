/**
 * Unit tests for client-time-core (server/client-time-core.js): the press
 * time clock in/out records.
 */
import { describe, it, expect } from 'vitest';

import { MAX_CLIENT_TIME_AGE_MS, clientTimeOrNow } from '../server/client-time-core';

const now = Date.UTC(2026, 10, 5, 15, 0);

describe('clientTimeOrNow', () => {
  it('uses a recent press time', () => {
    expect(clientTimeOrNow(now - 5 * 60_000, now)).toBe(now - 5 * 60_000);
  });

  it('ignores one older than 30 minutes', () => {
    expect(MAX_CLIENT_TIME_AGE_MS).toBe(30 * 60_000);
    expect(clientTimeOrNow(now - 31 * 60_000, now)).toBe(now);
  });

  it('takes a slightly fast clock as now, and ignores one far ahead', () => {
    expect(clientTimeOrNow(now + 10_000, now)).toBe(now);
    expect(clientTimeOrNow(now + 5 * 60_000, now)).toBe(now);
  });

  it('ignores anything that is not a number', () => {
    expect(clientTimeOrNow(undefined, now)).toBe(now);
    expect(clientTimeOrNow('2026-11-05', now)).toBe(now);
    expect(clientTimeOrNow(Number.NaN, now)).toBe(now);
  });
});
