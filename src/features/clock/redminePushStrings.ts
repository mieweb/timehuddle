/**
 * The words for sending ticket time to Redmine, shared by the two places that
 * send it: the push dialog on the Clock page (`RedminePushPanel`) and the
 * prompt shown when a ticket timer ends (`timers/RedmineSendPrompt`).
 */
import type { RedmineTimeEntryPushOutcome } from '../../lib/api';

/**
 * Dispatched on `window` after time is sent, or fails to be, outside the push
 * dialog, so the dialog's summary reloads.
 */
export const REDMINE_TIME_SENT_EVENT = 'redmine:time-sent';

/** The server's `MAX_COMMENT_LENGTH`: the longest comment Redmine accepts on a time entry. */
export const REDMINE_COMMENT_MAX_LENGTH = 1024;

/** Plain-English reasons, so a blocked row explains itself instead of just being disabled. */
export const BLOCKED_TEXT: Record<string, string> = {
  'too-short': 'Under a minute — Redmine rejects a zero-hour entry',
  'issue-unavailable': 'Issue could not be loaded from Redmine',
  'no-activity': 'This issue’s project allows no activity in Redmine',
};

const FAILURE_TEXT: Record<string, string> = {
  'no-log-time-permission': 'Your Redmine role is missing “Log spent time”',
  'rejected-by-redmine': 'Redmine rejected the entry',
  unreachable: 'Could not reach Redmine',
  'hours-mismatch': 'Redmine stored different hours than we sent',
  'no-entry-id': 'Redmine did not return an entry id',
  unconfirmed: 'Sent, but Redmine did not let us confirm it',
  'push-interrupted': 'Not sent: another push took over. Try again',
  'already-synced-or-gone': 'Already sent, or no longer eligible',
  'invalid-activity': 'This issue’s project does not allow that activity',
  'billable-changed':
    'Billable status changed in Redmine since you opened this. Nothing was sent: close it and open it again to review the new value',
};

/**
 * Billable is copied from an entry that already has it (#686). With none to
 * copy, Redmine refuses the entry; the way out is one Billable entry made in
 * Redmine itself, or an administrator who can sort out the field.
 */
const BILLABLE_REQUIRED_HINT =
  'Redmine requires a Billable status on every time entry, and TimeHuddle has none to copy yet. Log one time entry with Billable status set in Redmine, then send again. If that does not help, contact your Redmine administrator.';

/**
 * Redmine messages whose wording hides the fix, keyed by their English text.
 * "Issue is invalid" is what Redmine answers when the issue is fine but you may
 * not log time on it: it drops an issue the key cannot see, or one in a project
 * where your role lacks "Log spent time" or time tracking is switched off.
 */
const REDMINE_MESSAGE_HINTS: Record<string, string> = {
  'Issue is invalid':
    "Redmine won't take time on this issue from you: its project may have time tracking switched off, or your role there may be missing “Log spent time”.",
  'Billable status cannot be blank': BILLABLE_REQUIRED_HINT,
  'Billable cannot be blank': BILLABLE_REQUIRED_HINT,
};

/** Why a row failed: Redmine's own words when it gave any, else our summary. */
export function failureText(outcome: RedmineTimeEntryPushOutcome): string {
  if (outcome.detail?.length) {
    return outcome.detail
      .map((message) => REDMINE_MESSAGE_HINTS[message] ?? `Redmine: ${message}`)
      .join(' ');
  }
  const reason = outcome.reason ?? '';
  return FAILURE_TEXT[reason] ?? BLOCKED_TEXT[reason] ?? outcome.reason ?? 'Not sent';
}

/** `0.51` → `0:31`, so hours read the way the rest of the app shows time. */
export function asClock(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  return `${Math.floor(totalMinutes / 60)}:${String(totalMinutes % 60).padStart(2, '0')}`;
}

/**
 * Hours for display: as time worked (`0:09`), or as Redmine stores them
 * (`0.15 h`) when `decimal`.
 */
export function hoursLabel(hours: number, decimal: boolean): string {
  return decimal ? `${hours.toFixed(2)} h` : asClock(hours);
}

/** How the entry card names the current day. */
export const ENTRY_TODAY = 'Today';

/**
 * A logged day as people say it: "Today", else a short date in the reader's
 * own format ("Oct 12"), with the year only when it is not this one. `date` is
 * `YYYY-MM-DD`, read as a local day (a `Date` parse would treat it as UTC).
 */
export function entryDayLabel(date: string, today: Date = new Date()): string {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return date;
  if (year === today.getFullYear() && month === today.getMonth() + 1 && day === today.getDate()) {
    return ENTRY_TODAY;
  }
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(year === today.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/**
 * A Billable value as people read it. Redmine sends a yes/no field as `1`/`0`;
 * a list field's own words are shown as they are.
 */
export function billableValueLabel(value: string | string[]): string {
  if (Array.isArray(value)) return value.join(', ');
  return value === '1' ? entryCardText.yes : value === '0' ? entryCardText.no : value;
}

/** Words on the entry card, shared by both dialogs that send time. */
export const entryCardText = {
  activity: 'Activity',
  billable: 'Billable',
  yes: 'Yes',
  no: 'No',
  comment: 'Comment',
  commentPlaceholder: 'Optional',
  showAsTime: 'Show as time',
  showAsRedmineHours: 'Show as Redmine hours',
  addsUpRuns: (runs: number) => `Adds up ${runs} timer runs`,
};
