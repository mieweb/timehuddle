/**
 * A time the client sends for when something happened — the moment Clock in
 * or Clock out was pressed — so finishing an upload first doesn't move it.
 */

/** How old a client time may be and still count: a long upload's worth. */
export const MAX_CLIENT_TIME_AGE_MS = 30 * 60_000;

/** How far ahead of the server a client's clock may run before it's ignored. */
const MAX_CLIENT_CLOCK_SKEW_MS = 30_000;

/**
 * `at` (ms since the epoch) when it's a recent past time, else `now`: older
 * than `maxAgeMs`, not a number, or further in the future than a clock's skew
 * gives `now`; slightly ahead (a fast clock) is taken as `now`.
 */
export function clientTimeOrNow(at, now, maxAgeMs = MAX_CLIENT_TIME_AGE_MS) {
  if (typeof at !== 'number' || !Number.isFinite(at)) return now;
  if (at > now + MAX_CLIENT_CLOCK_SKEW_MS || at < now - maxAgeMs) return now;
  return Math.min(at, now);
}
