/**
 * The pin and dismissal rules, as one pure function (MVP2 A3).
 *
 * Six rules were agreed for dismissals, and all of them are read rules — they
 * decide what a stored row *means* now, not what to write. Keeping them in one
 * place, over plain rows and an explicit `now`, is what lets them be tested
 * without a database (see tests/redmine-prefs-core.test.ts); it is also why the
 * store does a single query and asks this function, rather than encoding each
 * rule again as a Mongo selector.
 *
 * | Rule | Where it lives |
 * | --- | --- |
 * | 1. Any suggestion may be dismissed, including one assigned to the user | `redmine.prefs.set` accepts any id |
 * | 2. A dismissal only hides that user's suggestions | only `redmine.issues.relevant` consults it |
 * | 3. It expires 15 days after `updatedAt` | `partitionIssuePrefs` (below) + the TTL index |
 * | 4. Dismissing again restarts the 15 days | `updatedAt` is rewritten on every set |
 * | 5. Reassignment to the user clears it | `partitionIssuePrefs` (below) |
 * | 6. A pin replaces a dismissal; `null` clears either | one row per (user, issue), unique index |
 *
 * Kept free of Meteor imports, like redmine-issues.js and redmine-activities.js.
 */

export const PINNED = 'pinned';
export const DISMISSED = 'dismissed';

/**
 * How long a dismissal lasts. Long enough that hiding a suggestion feels like it
 * stuck, short enough that a user cannot permanently blind themselves to an issue
 * they will be asked about — the suggestion list is a convenience, not a work
 * queue, and the issue is still findable by search the whole time.
 */
export const DISMISSAL_TTL_DAYS = 15;
export const DISMISSAL_TTL_MS = DISMISSAL_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * Most dismissals any one user may hold. A bound, not a feature: without it a
 * script calling `redmine.prefs.set` in a loop grows the collection without
 * limit, and nobody has 500 issues they want hidden.
 */
export const MAX_DISMISSALS_PER_USER = 500;

/**
 * Read one user's preference rows into the three answers callers need.
 *
 * - `pinnedIds` — worth 30 points to the relevant list, and never expire.
 * - `dismissedIds` — hide these from the suggestions, newest dismissal first.
 *   Rows past their 15 days are left out here as well as swept by the TTL index:
 *   Mongo's sweeper runs about once a minute, and "15 days" should not mean
 *   "15 days and a bit".
 * - `reviveIds` — dismissals the caller should now delete, because the issue has
 *   since been assigned to the user (rule 5). Being handed an issue is someone
 *   else's decision and it overrides a "not now" given before it happened. It
 *   does **not** override a deliberate dismissal of an issue that was already
 *   theirs, which is what `assignedToMeAtDismissal` records.
 *
 * A revived id is already absent from `dismissedIds`, so the list is correct on
 * the same call that notices the reassignment — the caller does not have to
 * re-read to get an accurate answer.
 *
 * @param {{issueId: number, state: string, updatedAt: Date, assignedToMeAtDismissal?: boolean}[]} rows
 * @param {{assignedIssueIds?: number[], now?: number}} [options]
 */
export function partitionIssuePrefs(rows, { assignedIssueIds = [], now = Date.now() } = {}) {
  const assigned = new Set(assignedIssueIds.map(Number));
  const cutoff = now - DISMISSAL_TTL_MS;

  const pinnedIds = [];
  const dismissals = [];
  const reviveIds = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    const issueId = Number(row?.issueId);
    if (!Number.isSafeInteger(issueId) || issueId <= 0) continue;

    if (row.state === PINNED) {
      pinnedIds.push(issueId);
      continue;
    }
    if (row.state !== DISMISSED) continue;

    if (row.assignedToMeAtDismissal === false && assigned.has(issueId)) {
      reviveIds.push(issueId);
      continue;
    }
    const at = new Date(row.updatedAt ?? 0).getTime();
    // An unparseable date is treated as expired: a row we cannot age is a row we
    // cannot honour, and the safe direction is to show the issue again.
    if (!Number.isFinite(at) || at <= cutoff) continue;
    dismissals.push({ issueId, at });
  }

  return {
    pinnedIds,
    dismissedIds: dismissals.sort((a, b) => b.at - a.at).map((row) => row.issueId),
    reviveIds,
  };
}

/**
 * The oldest dismissals to drop when a user is over the cap, newest kept.
 * Returns the ids to remove, so the store's delete is one statement.
 */
export function surplusDismissalIds(rows) {
  const dismissals = (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.state === DISMISSED)
    .map((row) => ({ issueId: Number(row.issueId), at: new Date(row.updatedAt ?? 0).getTime() }))
    .sort((a, b) => b.at - a.at);

  return dismissals.slice(MAX_DISMISSALS_PER_USER).map((row) => row.issueId);
}
