/**
 * Pure shaping for the manual push of ticket time into Redmine (M5, D2).
 *
 * Kept free of Meteor imports so the arithmetic and row shaping can be
 * unit-tested directly, matching redmine-net-hours.js / redmine-activities.js.
 * The Mongo and HTTP work lives in redmine-time-sync.js and redmine.js.
 */

/** Marker written into every entry's `comments` so its origin is legible in Redmine. */
export const PUSH_COMMENT = 'Logged by TimeHuddle';

/**
 * Seconds → decimal hours, rounded to 2 places.
 *
 * **The rounding rule, decided here and applied exactly once.** Two decimals is
 * Redmine's own display granularity, so the number a user sees in the
 * confirmation dialog is the number they will see in the Spent time tab — and
 * the read-back check after each write can compare for equality instead of
 * guessing at an epsilon.
 *
 * Rounding happens once, on the already-summed seconds for a whole ticket-day.
 * Rounding each session first and adding afterwards would let the error
 * accumulate (three 20-minute sessions would read 0.99h rather than 1.00h).
 *
 * The cost is up to 18 seconds lost per ticket-day, which is immaterial against
 * a daily total and is the same trade Redmine's own UI makes.
 */
export function toHours(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.round(seconds / 36) / 100;
}

/**
 * Whether a rounded total is worth sending.
 *
 * Redmine rejects a zero-hour entry, so anything under 18 seconds — which
 * rounds to `0.00` — must be withheld rather than pushed and failed. A stray
 * few-second session is a mis-click, not work, so dropping it is also the
 * honest outcome; it simply stays unsynced in Huddle.
 */
export function isPushable(hours) {
  return Number.isFinite(hours) && hours >= 0.01;
}

/**
 * Build the confirmation-dialog rows for a set of unsynced ticket-days.
 *
 * Pure: the caller supplies the already-computed net seconds, the issues it
 * resolved from Redmine, and an activity resolver. Rows come back sorted newest
 * day first, then by issue id, so the dialog reads in a stable order rather
 * than Mongo's.
 *
 * A ticket-day whose issue could not be resolved still appears — it is real
 * tracked time, and hiding it would silently drop work. It carries
 * `issueMissing: true` so the dialog can show it as unsendable instead.
 *
 * @param {Array<{ticketId: string, date: string, seconds: number}>} totals
 * @param {Map<string, {subject: string, trackerName: string|null}>} issuesById
 * @param {(trackerName: string|null) => {activityId: number|null, activityName: string|null, reason: string}} resolveActivity
 */
export function buildPushRows(totals, issuesById, resolveActivity) {
  if (!Array.isArray(totals)) return [];

  return totals
    .map((total) => {
      const issue = issuesById.get(String(total.ticketId)) ?? null;
      const hours = toHours(total.seconds);
      const activity = resolveActivity(issue?.trackerName ?? null);

      return {
        ticketId: String(total.ticketId),
        date: total.date,
        seconds: total.seconds,
        hours,
        subject: issue?.subject ?? null,
        trackerName: issue?.trackerName ?? null,
        issueMissing: issue === null,
        activityId: activity.activityId,
        activityName: activity.activityName,
        activityReason: activity.reason,
        // Every reason a row cannot be sent, so the dialog explains itself
        // rather than just disabling a checkbox.
        blockedReason: !isPushable(hours)
          ? 'too-short'
          : issue === null
            ? 'issue-unavailable'
            : activity.activityId == null
              ? 'no-activity'
              : null,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || Number(a.ticketId) - Number(b.ticketId));
}

/** The rows a push may actually send — everything else is shown but withheld. */
export function pushableRows(rows) {
  return rows.filter((row) => row.blockedReason === null);
}
