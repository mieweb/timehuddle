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
};

/**
 * Redmine messages whose wording hides the fix, keyed by their English text.
 * "Issue is invalid" is what Redmine answers when the issue is fine but you may
 * not log time on it: it drops an issue the key cannot see, or one in a project
 * where your role lacks "Log spent time" or time tracking is switched off.
 */
const REDMINE_MESSAGE_HINTS: Record<string, string> = {
  'Issue is invalid':
    "Redmine won't take time on this issue from you: its project may have time tracking switched off, or your role there may be missing “Log spent time”.",
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
