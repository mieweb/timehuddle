/**
 * Unit tests for the in-process rate limiter (server/rate-limit.js).
 *
 * Fixed windows with a fake clock. The one non-obvious rule is that a refused
 * call still counts: a client looping on the method should keep its own window
 * alive rather than slip one call through every time the last window lapses.
 */
import { describe, it, expect } from 'vitest';

import { createRateLimiter } from '../server/rate-limit';

/** A limiter driven by a clock the test moves. */
function limiterAt(limit: number, windowMs: number) {
  let clock = 1_000_000;
  const limiter = createRateLimiter({ limit, windowMs, now: () => clock });
  return { limiter, advance: (ms: number) => (clock += ms) };
}

describe('createRateLimiter', () => {
  it('allows calls up to the limit and refuses the next one', () => {
    const { limiter } = limiterAt(3, 10_000);
    expect([1, 2, 3].map(() => limiter.check('u1').allowed)).toEqual([true, true, true]);
    expect(limiter.check('u1').allowed).toBe(false);
  });

  it('counts each caller separately', () => {
    const { limiter } = limiterAt(1, 10_000);
    expect(limiter.check('u1').allowed).toBe(true);
    expect(limiter.check('u2').allowed).toBe(true);
    expect(limiter.check('u1').allowed).toBe(false);
  });

  it('starts a fresh window once the old one has lapsed', () => {
    const { limiter, advance } = limiterAt(1, 10_000);
    expect(limiter.check('u1').allowed).toBe(true);
    expect(limiter.check('u1').allowed).toBe(false);

    advance(10_001);
    expect(limiter.check('u1').allowed).toBe(true);
  });

  it('keeps the window alive while a refused caller keeps calling', () => {
    const { limiter, advance } = limiterAt(1, 10_000);
    limiter.check('u1');

    // Hammering across almost the whole window: the window never resets, so the
    // caller does not get a free call as soon as the original one would expire.
    for (let elapsed = 0; elapsed < 9_000; elapsed += 1_000) {
      advance(1_000);
      expect(limiter.check('u1').allowed).toBe(false);
    }
  });

  it('reports how long is left on the window', () => {
    const { limiter, advance } = limiterAt(1, 10_000);
    limiter.check('u1');
    advance(4_000);
    expect(limiter.check('u1').retryAfterMs).toBe(6_000);
  });
});
