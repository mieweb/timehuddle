/**
 * The Redmine suggestion surface (MVP2) — what TimeHuddle offers a user before
 * and while they type in the Tickets search bar.
 *
 * MVP1 asked Redmine for every issue the user's key could see and filtered in the
 * browser. On the enterprise instance that is an enormous response, and every
 * subject in it may carry PHI, so MVP2 replaces it with questions that are
 * narrow by construction:
 *
 *   - `redmine.issues.relevant` — merge a handful of filtered signals into the
 *     list shown on focus (Task A1),
 *   - `redmine.issues.search`   — one bounded query for what the user typed (A2),
 *   - `redmine.prefs.set` / `redmine.prefs.listDismissed` — TimeHuddle's own pins
 *     and dismissals, which Redmine has no field for (A3).
 *
 * Every call runs under the caller's own personal API key, so Redmine's own
 * visibility rules decide what comes back and there is no admin key to leak.
 * Nothing Redmine returns is persisted: the only rows written are the ids in
 * `RedmineIssuePrefs`.
 */
import { Meteor } from 'meteor/meteor';

import { requireIdentity } from './auth-bridge';
import { findRedmineAccount, requireRedmineAccount } from './redmine-account';
import { getIssue, listIssuesByIds, optionalRedmineBaseUrl } from './redmine-client';
import { toIssue } from './redmine-issues';
import {
  DISMISSED,
  PINNED,
  dismissedIssueIds,
  ensureRedmineIssuePrefIndexes,
  setIssuePref,
} from './redmine-prefs';
import { RedmineLinks } from './collections';
import { toRedmineMeteorError } from './redmine';
import { isRedmineIssueId } from './ticket-refs';

Meteor.startup(async () => {
  try {
    await ensureRedmineIssuePrefIndexes();
  } catch (error) {
    console.error('[redmine] failed to create issue-preference indexes:', error);
  }
});

/**
 * `issueId` as a number, or a `bad-request`. Coerced rather than merely checked:
 * the id is stored and matched against numeric ids, so `"42"` arriving over REST
 * must not become a string row that `$in` will never find again.
 */
function requireIssueId(issueId) {
  if (!isRedmineIssueId(issueId)) {
    throw new Meteor.Error('bad-request', 'A Redmine issue id is required.');
  }
  return Number(issueId);
}

/**
 * Whether `issueId` is assigned to the caller right now — the one thing a
 * dismissal has to know about the issue it is hiding (rule 5).
 *
 * Asked of Redmine rather than of whatever the client had on screen, because the
 * answer decides whether the dismissal can be undone by someone else's action.
 * When Redmine cannot be reached the answer is **yes**: that makes the dismissal
 * permanent for its 15 days, which honours what the user just did. Guessing "no"
 * would risk the reassignment rule firing on the next list build and putting the
 * row straight back.
 */
async function isAssignedToCaller(userId, account, issueId) {
  const link = await RedmineLinks.findOneAsync({ userId }, { fields: { redmineUserId: 1 } });
  try {
    const issue = await getIssue(account, issueId);
    if (!issue) return true;
    return issue.assigned_to?.id != null && issue.assigned_to.id === link?.redmineUserId;
  } catch {
    return true;
  }
}

Meteor.methods({
  /**
   * Pin, dismiss or clear one Redmine issue for the caller (A3).
   *
   * `state: null` clears it — Undo in the dropdown and Restore in Settings are
   * the same call. A dismissal affects only this user's suggestions: nothing here
   * touches Redmine, other users, search results, the Tickets table or timers.
   */
  async 'redmine.prefs.set'({ issueId, state } = {}) {
    const { userId } = await requireIdentity(this);
    const id = requireIssueId(issueId);
    if (state !== PINNED && state !== DISMISSED && state !== null) {
      throw new Meteor.Error('bad-request', 'state must be "pinned", "dismissed" or null.');
    }

    // Only a dismissal needs to know how the issue stood at the time.
    const assignedToMe =
      state === DISMISSED ? await isAssignedToCaller(userId, await requireRedmineAccount(userId), id) : true;

    await setIssuePref(userId, id, state, { assignedToMe });
    return { ok: true };
  },

  /**
   * The issues the caller has hidden, for the Restore list in Settings (A3).
   *
   * Titles are resolved here, from Redmine, at read time — `RedmineIssuePrefs`
   * stores ids only. An issue whose title cannot be fetched is dropped rather
   * than shown as a bare number: the list exists to be recognised, and a Restore
   * button next to "#4821" tells the user nothing.
   */
  async 'redmine.prefs.listDismissed'() {
    const { userId } = await requireIdentity(this);

    const issueIds = await dismissedIssueIds(userId);
    if (!issueIds.length) return { connected: true, baseUrl: optionalRedmineBaseUrl(), issues: [] };

    const account = await findRedmineAccount(userId);
    if (!account) return { connected: false, baseUrl: optionalRedmineBaseUrl(), issues: [] };

    let raw;
    try {
      raw = await listIssuesByIds(account, issueIds.slice(0, 100));
    } catch (err) {
      throw toRedmineMeteorError(err);
    }

    // Keep the user's own dismissal order (newest first) rather than Redmine's.
    const byId = new Map(raw.map((issue) => [issue.id, toIssue(issue)]));
    return {
      connected: true,
      baseUrl: account.baseUrl,
      issues: issueIds.map((id) => byId.get(id)).filter(Boolean),
    };
  },
});
