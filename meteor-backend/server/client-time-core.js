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

/**
 * When a clock-in pressed at `at` starts: the press time (clientTimeOrNow),
 * but never before the team's last clock-out (`lastEndTime`), so a backdated
 * start can't overlap the session before it, nor before a session still open
 * (`openStartTimes`), which it closes at that time.
 */
export function clockStartTime(at, now, { lastEndTime = 0, openStartTimes = [] } = {}) {
  return Math.max(clientTimeOrNow(at, now), lastEndTime, ...openStartTimes);
}

/**
 * When a clock-out pressed at `at` ends the session: the press time, but never
 * before what it closes began or what already ended in it — the session
 * (`startTime`), its breaks (`breakTimes`: an open one's start, a closed one's
 * end) and its ticket timers (`timerTimes`: a running one's start, one stopped
 * since the press its end) — so nothing ends before it started and no break or
 * ticket time outlasts the shift.
 */
export function clockStopTime(at, now, { startTime, breakTimes = [], timerTimes = [] }) {
  return Math.max(clientTimeOrNow(at, now), startTime, ...breakTimes, ...timerTimes);
}
