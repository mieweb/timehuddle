/**
 * Unit tests for redmine-cache (server/redmine-cache.js).
 *
 * Guards the three properties callers rely on: a fresh hit skips the fetch,
 * a failed fetch is not cached, and a disconnect busts one user everywhere
 * without touching anyone else.
 */
import { describe, it, expect, vi } from 'vitest';

import { bustUserCaches, createUserTtlCache } from '../server/redmine-cache';

describe('createUserTtlCache', () => {
  it('serves a fresh entry without refetching', async () => {
    const cache = createUserTtlCache(60_000);
    const fetchFn = vi.fn(async () => ['a']);
    expect(await cache.get('u1', 'k', fetchFn)).toEqual(['a']);
    expect(await cache.get('u1', 'k', fetchFn)).toEqual(['a']);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('refetches once the entry has expired', async () => {
    const cache = createUserTtlCache(-1);
    const fetchFn = vi.fn(async () => 'v');
    await cache.get('u1', 'k', fetchFn);
    await cache.get('u1', 'k', fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed fetch', async () => {
    const cache = createUserTtlCache(60_000);
    await expect(
      cache.get('u1', 'k', async () => {
        throw new Error('down');
      }),
    ).rejects.toThrow('down');
    expect(await cache.get('u1', 'k', async () => 'recovered')).toBe('recovered');
  });

  it('busts one user across every cache and leaves others alone', async () => {
    const first = createUserTtlCache(60_000);
    const second = createUserTtlCache(60_000);
    await first.get('u1', 'k', async () => 'u1-first');
    await second.get('u1', 'k', async () => 'u1-second');
    await first.get('u2', 'k', async () => 'u2-first');

    bustUserCaches('u1');

    expect(await first.get('u1', 'k', async () => 'fresh')).toBe('fresh');
    expect(await second.get('u1', 'k', async () => 'fresh')).toBe('fresh');
    expect(await first.get('u2', 'k', async () => 'unused')).toBe('u2-first');
  });
});
