/**
 * Unit tests for huddle-window-core (server/huddle-window-core.js), #635.
 */
import { describe, it, expect } from 'vitest';

import { DEFAULT_WINDOW_DAYS, isBeforeWindow, resolveSince } from '../server/huddle-window-core';

const NOW = Date.parse('2026-10-06T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

describe('resolveSince', () => {
  it('defaults to the last 30 days', () => {
    expect(resolveSince(undefined, NOW)?.getTime()).toBe(NOW - DEFAULT_WINDOW_DAYS * DAY_MS);
    expect(resolveSince(null, NOW)?.getTime()).toBe(NOW - 30 * DAY_MS);
  });

  it('reads an ISO date string', () => {
    expect(resolveSince('2026-08-01T00:00:00.000Z', NOW)?.toISOString()).toBe(
      '2026-08-01T00:00:00.000Z',
    );
  });

  it('is null for anything that is not a valid date string', () => {
    expect(resolveSince('not a date', NOW)).toBeNull();
    expect(resolveSince('', NOW)).toBeNull();
    expect(resolveSince(12345 as unknown as string, NOW)).toBeNull();
  });
});

describe('isBeforeWindow', () => {
  const since = new Date('2026-09-06T00:00:00.000Z');

  it('is true only for a post created before the boundary', () => {
    expect(isBeforeWindow(new Date('2026-09-05T23:59:59.999Z'), since)).toBe(true);
    expect(isBeforeWindow(new Date('2026-09-06T00:00:00.000Z'), since)).toBe(false);
    expect(isBeforeWindow('2026-10-01T00:00:00.000Z', since)).toBe(false);
  });
});
