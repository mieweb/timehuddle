/**
 * Storage for TimeHuddle's own opinions about Redmine issues (MVP2 A3).
 *
 * Redmine has no field for "keep this near the top of my list" or "stop
 * suggesting this to me", so those live here. Two states, one row each:
 *
 *   - **pinned** — the user, or starting a timer on their behalf, said this issue
 *     matters. Worth 30 points to the relevant list, and permanent until cleared.
 *   - **dismissed** — the user pressed the x on a suggestion. Hides the issue from
 *     *their own* search suggestions and nothing else: not from search results,
 *     not from the Tickets table, not from anyone else's view, and never from
 *     Redmine. It expires by itself after 15 days.
 *
 * **Ids only.** A row holds a user id, an issue id, a state, one boolean and a
 * date. No subject, no project, no description — resolving a dismissal's title
 * for the Settings list is a read-time `listIssuesByIds` call, so TimeHuddle
 * never becomes a second, staler, unaudited copy of the issue tracker.
 *
 * This module is the Mongo half. What the rows *mean* — the expiry, the
 * reassignment rule, the cap — is in redmine-prefs-core.js, which is why reads
 * here are a single query handed to one pure function instead of a selector per
 * rule.
 */
import { RedmineIssuePrefs } from './collections';
import { bustUserCaches } from './redmine-cache';
import {
  DISMISSAL_TTL_MS,
  DISMISSED,
  PINNED,
  partitionIssuePrefs,
  surplusDismissalIds,
} from './redmine-prefs-core';

export { DISMISSED, PINNED } from './redmine-prefs-core';

/**
 * Create the indexes the rules depend on.
 *
 * The unique index is the invariant: one row per (user, issue), so pinning a
 * dismissed issue replaces the dismissal rather than racing it (rule 6). The TTL
 * index covers `state: 'dismissed'` only — pins are not a cache and must never be
 * swept — and `expireAfterSeconds` is measured from `updatedAt`, so dismissing
 * the same issue again restarts the clock for free (rule 4).
 */
export async function ensureRedmineIssuePrefIndexes() {
  await RedmineIssuePrefs.createIndexAsync(
    { userId: 1, issueId: 1 },
    { unique: true, name: 'unique_redmine_issue_pref' },
  );
  await RedmineIssuePrefs.createIndexAsync(
    { updatedAt: 1 },
    {
      name: 'expire_redmine_dismissals',
      expireAfterSeconds: DISMISSAL_TTL_MS / 1000,
      partialFilterExpression: { state: DISMISSED },
    },
  );
}

/**
 * Record, replace or clear one preference.
 *
 * `state: null` removes the row — Undo in the dropdown and Restore in Settings
 * are the same call. `assignedToMe` is stored for a dismissal only, and only so
 * the reassignment rule can tell "I hid an issue that was already mine" from
 * "I hid an issue that later became mine".
 */
export async function setIssuePref(userId, issueId, state, { assignedToMe = true } = {}) {
  if (state === null) {
    await RedmineIssuePrefs.removeAsync({ userId, issueId });
  } else {
    await RedmineIssuePrefs.upsertAsync(
      { userId, issueId },
      {
        $set: {
          userId,
          issueId,
          state,
          updatedAt: new Date(),
          ...(state === DISMISSED ? { assignedToMeAtDismissal: assignedToMe === true } : {}),
        },
        ...(state === PINNED ? { $unset: { assignedToMeAtDismissal: '' } } : {}),
      },
    );
    if (state === DISMISSED) await trimDismissals(userId);
  }
  // The relevant list is cached for 90 seconds and this changed what belongs in
  // it, so the next call must recompute rather than serve the pre-dismissal list.
  bustUserCaches(userId);
}

/**
 * Pin an issue, leaving an existing pin's date alone. Used by the timer-start
 * path, which fires on every start — rewriting `updatedAt` there would be pure
 * write noise, since a pin does not expire and its date carries no meaning.
 */
export async function pinIssueIfUnset(userId, issueId) {
  const held = await RedmineIssuePrefs.findOneAsync({ userId, issueId }, { fields: { state: 1 } });
  if (held?.state === PINNED) return;
  await setIssuePref(userId, issueId, PINNED);
}

/** Keep only the newest `MAX_DISMISSALS_PER_USER` dismissals for one user. */
async function trimDismissals(userId) {
  const surplus = surplusDismissalIds(await allPrefRows(userId));
  if (surplus.length) {
    await RedmineIssuePrefs.removeAsync({ userId, issueId: { $in: surplus } });
  }
}

/** Every preference row for one user — ids, states and dates, bounded by the cap. */
function allPrefRows(userId) {
  return RedmineIssuePrefs.find(
    { userId },
    { fields: { issueId: 1, state: 1, updatedAt: 1, assignedToMeAtDismissal: 1 } },
  ).fetchAsync();
}

/**
 * This user's pins and live dismissals, with rule 5 applied.
 *
 * One query, one decision: dismissals of issues now assigned to the user are
 * deleted here and are already absent from `dismissedIds`, so the caller gets a
 * correct answer without a second read. `assignedIssueIds` comes from the
 * relevant list's own "assigned to me" signal, so the rule costs no extra
 * Redmine call.
 */
export async function readIssuePrefs(userId, { assignedIssueIds = [], now = Date.now() } = {}) {
  const partitioned = partitionIssuePrefs(await allPrefRows(userId), { assignedIssueIds, now });
  if (partitioned.reviveIds.length) {
    await RedmineIssuePrefs.removeAsync({ userId, issueId: { $in: partitioned.reviveIds } });
  }
  return partitioned;
}

/** The ids this user has hidden, newest first — the Restore list in Settings. */
export async function dismissedIssueIds(userId, now = Date.now()) {
  return partitionIssuePrefs(await allPrefRows(userId), { now }).dismissedIds;
}

/** Forget every preference a user holds. Called when they unlink their Redmine account. */
export function removeUserIssuePrefs(userId) {
  return RedmineIssuePrefs.removeAsync({ userId });
}
