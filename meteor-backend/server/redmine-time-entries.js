/**
 * Pure shaping for the manual push of ticket time into Redmine. The Mongo and
 * HTTP work lives in redmine-time-sync.js and redmine.js.
 */
import { ticketDayKey } from './redmine-net-hours';

/** An entry's `comments` when the user wrote none, so its origin is legible in Redmine. */
export const PUSH_COMMENT = 'Logged by TimeHuddle';

/** The longest comment Redmine accepts on a time entry. */
export const MAX_COMMENT_LENGTH = 1024;

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
  return minutesToHours(wholeMinutes(seconds));
}

/**
 * Seconds as the whole minutes Redmine holds. Any tracked time is at least one
 * minute, the least Redmine accepts, so a short stint is never left unsendable.
 */
function wholeMinutes(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.max(1, Math.round(seconds / 60));
}

/** Whole minutes as the 2-decimal hours Redmine is sent. */
function minutesToHours(minutes) {
  return Math.round((minutes / 60) * 100) / 100;
}

/** Whole minutes rounded up to a multiple of `step`; without one they stay as they are. */
export function roundUpMinutes(minutes, step) {
  return step ? Math.ceil(minutes / step) * step : minutes;
}

/**
 * The hours to send for one unsent total (see `unsentTotals`): its `minutes`,
 * or without them its seconds rounded as they stand.
 */
export function hoursToSend(total) {
  return total.minutes == null ? toHours(total.seconds) : minutesToHours(total.minutes);
}

/**
 * Whether a total has anything to send.
 *
 * Redmine rejects a zero-hour entry, so a total whose time Redmine already
 * holds — new seconds covered by what an earlier entry rounded up — is withheld
 * rather than pushed and failed. The smallest figure that can be sent is one
 * minute, `0.02h`.
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
 * A server that rounds up works the same way: the day's total is rounded up to
 * its step, and only what Redmine does not hold yet is sent, so time already
 * covered by a rounded-up entry sends nothing more. `rounding` then carries the
 * step and the exact minutes, for the dialog to show both.
 *
 * A ticket-day with nothing new is dropped. One whose new seconds are already
 * covered is kept with no minutes to send, so they count once the day passes
 * what Redmine holds.
 *
 * @param {Map<string, {seconds: number, discardedSeconds: number, minutes: number}>} ledgerByKey
 *   what has been handled per `ticketId|date` — see `pushLedgerFor`
 * @param {Map<string, number>} [stepByKey] the minutes each ticket-day rounds up to; none is exact
 *
 * `runSeconds` is the timer runs that difference is made of, oldest first.
 *
 * @returns {Array<{ticketId: string, date: string, seconds: number, alreadySentSeconds: number, minutes: number, runSeconds: number[], rounding?: {step: number, exactMinutes: number}}>}
 */
export function unsentTotals(totals, ledgerByKey, stepByKey = new Map()) {
  if (!Array.isArray(totals)) return [];
  return totals
    .map((total) => {
      const key = ticketDayKey(total.ticketId, total.date);
      const held = ledgerByKey.get(key) ?? NOTHING_HANDLED;
      const step = stepByKey.get(key);
      // Discarded time is never owed to Redmine, so it is left out of the target.
      const owedMinutes = wholeMinutes(total.seconds - held.discardedSeconds);
      const seconds = Math.max(0, total.seconds - held.seconds);
      // The time worked since the last send. Not owed minutes less what was
      // sent: an earlier entry rounded up would make the new work look shorter.
      const exactMinutes = Math.round(seconds / 60);
      return {
        ticketId: total.ticketId,
        date: total.date,
        seconds,
        alreadySentSeconds: held.seconds,
        minutes: Math.max(0, roundUpMinutes(owedMinutes, step) - held.minutes),
        ...(step ? { rounding: { step, exactMinutes } } : {}),
        runSeconds: unsentRuns(total.runSeconds, seconds),
      };
    })
    .filter((total) => total.seconds > 0);
}

const NOTHING_HANDLED = { seconds: 0, discardedSeconds: 0, minutes: 0 };

/**
 * The timer runs that make up a ticket-day's unsent seconds. The ledger holds
 * seconds, not runs, but each send covers every run closed by then, so the unsent
 * time is normally the newest runs: go back from the latest until they cover it.
 * Moving or editing an entry can break that, so when no run list adds up to the
 * unsent time there is none to show: it never contradicts the total.
 *
 * @param {number[]} [runSeconds] each run's seconds, oldest first
 */
function unsentRuns(runSeconds = [], unsentSeconds) {
  let covered = 0;
  let first = runSeconds.length;
  while (first > 0 && covered < unsentSeconds) covered += runSeconds[--first];
  return covered === unsentSeconds ? runSeconds.slice(first) : [];
}

/**
 * What one ticket-day has left to send, out of `unsentTotals`' result:
 * `{ ticketId, date, hours }`, or null when it has nothing unsent or only time
 * an earlier entry already covers.
 */
export function sendableForTicketDay(unsent, ticketId, date) {
  const key = ticketDayKey(ticketId, date);
  const total = unsent.find((each) => ticketDayKey(each.ticketId, each.date) === key);
  const hours = total ? hoursToSend(total) : 0;
  return isPushable(hours) ? { ticketId: String(ticketId), date, hours } : null;
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
 * @param {Array<{ticketId: string, date: string, seconds: number, alreadySentSeconds?: number, minutes?: number, runSeconds?: number[]}>} totals
 *   `seconds` is the unsent time only, and `minutes` what to send for it — see
 *   `unsentTotals`. Without `minutes`, the seconds are rounded as they stand.
 * @param {Map<string, {subject: string, trackerName: string|null, projectId?: number|null, billable?: {id: number, name: string, value: string|string[]}|null}>} issuesById
 * @param {(issue: {trackerName: string|null}|null) => {activityId: number|null, activityName: string|null, reason: string, options?: Array<{id: number, name: string}>}} resolveActivity
 *   the activity for one issue, and the `options` its project allows. An
 *   unresolved issue is passed as null.
 */
export function buildPushRows(totals, issuesById, resolveActivity) {
  if (!Array.isArray(totals)) return [];

  return totals
    .map((total) => {
      const issue = issuesById.get(String(total.ticketId)) ?? null;
      const hours = hoursToSend(total);
      const activity = resolveActivity(issue);

      return {
        ticketId: String(total.ticketId),
        date: total.date,
        seconds: total.seconds,
        alreadySentSeconds: total.alreadySentSeconds ?? 0,
        runSeconds: total.runSeconds ?? [],
        hours,
        subject: issue?.subject ?? null,
        trackerName: issue?.trackerName ?? null,
        issueMissing: issue === null,
        activityId: activity.activityId,
        activityName: activity.activityName,
        activityReason: activity.reason,
        // What the row may be sent under. `push` checks an override against it.
        activityOptions: activity.options ?? [],
        // The Billable field the entry is sent with, or null for none (#686).
        billable: issue?.billable ?? null,
        // The step the hours were rounded up to, and the exact hours; null for exact.
        rounding: total.rounding
          ? { step: total.rounding.step, exactHours: minutesToHours(total.rounding.exactMinutes) }
          : null,
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
