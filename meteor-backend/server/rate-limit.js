/**
 * Per-caller rate limiting for Meteor methods, applied inside the method.
 *
 * **Why not `DDPRateLimiter`.** Meteor's own limiter is applied in
 * `_livedata_method` — the DDP *message* handler. Every call from this app
 * arrives instead through meteor-wormhole's REST bridge, which invokes the method
 * with `Meteor.callAsync` on the server; that path never touches
 * `_livedata_method`, so a `DDPRateLimiter` rule would guard a door the client
 * does not use. Calling the limit from the method itself covers REST, MCP and DDP
 * with one mechanism, and cannot be bypassed by arriving a different way.
 *
 * Fixed windows, counted in process. That is honest for this deployment — one
 * Meteor process under PM2 — and the limit becomes per-process if it is ever
 * scaled out horizontally, which is a reason to move the counter to Mongo or
 * Redis at that point, not a reason to have no limit now.
 *
 * Kept free of Meteor imports so the windowing can be unit-tested with a fake
 * clock (see tests/rate-limit.test.ts).
 */

/** Stop the counter map growing without bound when keys are one-off. */
const MAX_TRACKED_KEYS = 10_000;

/**
 * A limiter allowing `limit` calls per `windowMs` per key.
 *
 * `check(key)` counts the call and says whether it is allowed. Counting the call
 * that is refused is deliberate: a client hammering the method keeps its window
 * alive rather than slipping one call through each time the old window lapses.
 *
 * @param {{limit: number, windowMs: number, now?: () => number}} options
 */
export function createRateLimiter({ limit, windowMs, now = Date.now }) {
  /** @type {Map<string, {count: number, resetAt: number}>} */
  const windows = new Map();

  function prune(currentMs) {
    for (const [key, window] of windows) {
      if (window.resetAt <= currentMs) windows.delete(key);
    }
  }

  return {
    /** @returns {{allowed: boolean, retryAfterMs: number}} */
    check(key) {
      const currentMs = now();
      if (windows.size >= MAX_TRACKED_KEYS) prune(currentMs);

      const held = windows.get(key);
      const window =
        held && held.resetAt > currentMs ? held : { count: 0, resetAt: currentMs + windowMs };
      window.count += 1;
      windows.set(key, window);

      return {
        allowed: window.count <= limit,
        retryAfterMs: Math.max(0, window.resetAt - currentMs),
      };
    },
  };
}
