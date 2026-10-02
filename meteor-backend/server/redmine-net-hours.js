/**
 * Net worked seconds for one user, one ticket, one day.
 *
 * **Nothing is ever subtracted here.** Breaks are excluded *structurally*:
 * `clock.pause` closes the running session and stamps its duration, and
 * `clock.resume` opens a brand-new one, so break time never appears in any
 * session in the first place. One work stretch therefore becomes N sessions.
 *
 * The `accumulatedTime = span - deducted` model belongs to the shift clock
 * (System A) only. Applying it to ticket timers (System B) would double-count
 * the break as a deduction against time that never included it. The net total
 * is a plain sum of closed session durations — nothing more.
 *
 * Kept free of Meteor imports: the Mongo-touching query that feeds it lives in
 * timer-core.js, which cannot be imported from vitest because it pulls in
 * `meteor/mongo` at module scope.
 */

/**
 * The key one ticket-day is grouped and looked up by. Every side of the push —
 * the totals, the sent-seconds ledger, the preview rows and the request — must
 * build it the same way, so they all build it here.
 */
export const ticketDayKey = (ticketId, date) => `${ticketId}|${date}`;

/**
 * Sum the durations of closed sessions.
 *
 * A session still running has no final duration and must not be projected to
 * Redmine mid-flight, so anything without an `endTime` contributes zero. A
 * non-finite `durationSeconds` is likewise skipped rather than poisoning the
 * total with `NaN`.
 *
 * @param {Array<{endTime?: number|null, durationSeconds?: number|null}>} sessions
 * @returns {number} whole seconds, never negative
 */
export function sumClosedSessions(sessions) {
  if (!Array.isArray(sessions)) return 0;

  let total = 0;
  for (const session of sessions) {
    if (!session || session.endTime == null) continue;
    const seconds = session.durationSeconds;
    if (!Number.isFinite(seconds) || seconds <= 0) continue;
    total += seconds;
  }
  return Math.floor(total);
}
