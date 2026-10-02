/**
 * Pure shaping for the manual push of ticket time into Redmine. The Mongo and
 * HTTP work lives in redmine-time-sync.js and redmine.js.
 */
import { ticketDayKey } from './redmine-net-hours';

/** Marker written into every entry's `comments` so its origin is legible in Redmine. */
export const PUSH_COMMENT = 'Logged by TimeHuddle';

/**
 * Seconds → the decimal hours to send Redmine.
 *
 * **Quantized to whole minutes, then expressed to 2 places, and applied exactly
 * once.** Redmine does not store what you send verbatim: it converts the
 * submitted hours to whole minutes (`round(hours * 60)`) and reports them back
 * to two decimals: sending `7.39` stores `443` minutes and reads back as
 * `7.38`, while `0.11` stores `7` minutes and reads back as `0.12`.
 *
 * Rounding the seconds to minutes first makes the value survive that trip
 * unchanged — the number in the confirmation dialog, the number stored, and the
 * number read back are all the same. Sending a plain 2-decimal figure does not:
 * `0.11h` is 6.6 minutes, which Redmine rounds up to 7.
 *
 * The quantization happens once, on the already-summed seconds for a whole
 * ticket-day. Rounding each session first and adding afterwards would let the
 * error accumulate (three 20-minute sessions would read 0.99h rather than
 * 1.00h).
 *
 * The cost is up to 30 seconds per ticket-day, which is inherent: Redmine
 * cannot hold a finer figure than a minute.
 */
export function toHours(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return minutesToHours(Math.round(seconds / 60));
}

/** Whole minutes as the 2-decimal hours Redmine is sent. */
function minutesToHours(minutes) {
  return Math.round((minutes / 60) * 100) / 100;
}

/**
 * Whether a rounded total is worth sending.
 *
 * Redmine rejects a zero-hour entry, so anything under 30 seconds — which
 * quantizes to zero minutes — must be withheld rather than pushed and failed. A
 * stray few-second session is a mis-click, not work, so dropping it is also the
 * honest outcome; it simply stays unsynced in Huddle. The smallest figure that
 * can be sent is one minute, `0.02h`.
 */
export function isPushable(hours) {
  return Number.isFinite(hours) && hours >= 0.01;
}

/** One minute in decimal hours, plus a little room for float noise. */
const ONE_MINUTE_HOURS = 1 / 60 + 1e-9;

/**
 * Whether the hours Redmine stored match what was sent.
 *
 * `toHours` makes the two agree exactly, so this is a safety net rather than
 * the mechanism: it exists to catch Redmine storing something *materially*
 * different (a workflow, a plugin, a wrong issue), not its own minute
 * quantization. A gap of a minute or less is display granularity; anything
 * larger is a real discrepancy and still flags the row.
 */
export function hoursAgree(sent, stored) {
  if (!Number.isFinite(sent) || !Number.isFinite(stored)) return false;
  return Math.abs(sent - stored) <= ONE_MINUTE_HOURS;
}

/**
 * The time on each ticket-day that has not yet reached Redmine.
 *
 * A ticket-day can be pushed more than once: a user may push mid-day and keep
 * working. Entries are create-only, so later work goes up as a further
 * entry covering just the difference.
 *
 * `seconds` is that difference in raw seconds, which is what the ledger records.
 * `minutes` is what to send: the whole minutes the day's total comes to, less
 * the minutes Redmine already holds. Rounding the total rather than each
 * difference is what stops repeated pushes drifting — two 30-second pushes
 * would otherwise each round up, and put two minutes in Redmine for one worked.
 *
 * A ticket-day with nothing new is dropped; one with a few new seconds is kept,
 * so short stretches accumulate until they are worth sending.
 *
 * @param {Map<string, {seconds: number, discardedSeconds: number, minutes: number}>} ledgerByKey
 *   what has been handled per `ticketId|date` — see `pushLedgerFor`
 * @returns {Array<{ticketId: string, date: string, seconds: number, alreadySentSeconds: number, minutes: number}>}
 */
export function unsentTotals(totals, ledgerByKey) {
  if (!Array.isArray(totals)) return [];
  return totals
    .map((total) => {
      const held = ledgerByKey.get(ticketDayKey(total.ticketId, total.date)) ?? NOTHING_HANDLED;
      // Discarded time is never owed to Redmine, so it is left out of the target.
      const owedMinutes = Math.round((total.seconds - held.discardedSeconds) / 60);
      return {
        ticketId: total.ticketId,
        date: total.date,
        seconds: Math.max(0, total.seconds - held.seconds),
        alreadySentSeconds: held.seconds,
        minutes: Math.max(0, owedMinutes - held.minutes),
      };
    })
    .filter((total) => total.seconds > 0);
}

const NOTHING_HANDLED = { seconds: 0, discardedSeconds: 0, minutes: 0 };

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
 * @param {Array<{ticketId: string, date: string, seconds: number, alreadySentSeconds?: number, minutes?: number}>} totals
 *   `seconds` is the unsent time only, and `minutes` what to send for it — see
 *   `unsentTotals`. Without `minutes`, the seconds are rounded as they stand.
 * @param {Map<string, {subject: string, trackerName: string|null}>} issuesById
 * @param {(trackerName: string|null) => {activityId: number|null, activityName: string|null, reason: string}} resolveActivity
 */
export function buildPushRows(totals, issuesById, resolveActivity) {
  if (!Array.isArray(totals)) return [];

  return totals
    .map((total) => {
      const issue = issuesById.get(String(total.ticketId)) ?? null;
      const hours =
        total.minutes == null ? toHours(total.seconds) : minutesToHours(total.minutes);
      const activity = resolveActivity(issue?.trackerName ?? null);

      return {
        ticketId: String(total.ticketId),
        date: total.date,
        seconds: total.seconds,
        alreadySentSeconds: total.alreadySentSeconds ?? 0,
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
