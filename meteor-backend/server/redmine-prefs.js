/**
 * Storage for TimeHuddle's own opinions about Redmine issues.
 *
 * Redmine has no field for "keep this near the top of my list" or "stop
 * suggesting this to me", so those live here. Three states, one row each:
 *
 *   - **pinned** — the user, or starting a timer on their behalf, said this issue
 *     matters. Permanent until cleared.
 *   - **dismissed** — the user pressed the x on a suggestion. Hides the issue from
 *     *their own* search suggestions and nothing else, and expires by itself.
 *   - **removed** — the user deleted the issue from their Tickets table (bulk
 *     Delete). Nothing in Redmine changes.
 *
 * **Ids only.** A row holds a user id, an issue id, a state, one boolean and a
 * date. No subject, no project, no description — resolving a dismissal's title
 * for the Settings list is a read-time `listIssuesByIds` call, so TimeHuddle
 * never becomes a second, staler, unaudited copy of the issue tracker.
 *
 * This module is the Mongo half. What the rows *mean* — the numbered rules, the
 * expiry, the caps — is in redmine-prefs-core.js, which is why reads here are a
 * single query handed to one pure function instead of a selector per rule.
 */
import { RedmineIssuePrefs } from './collections';
import { bustUserCaches } from './redmine-cache';
import {
  DISMISSAL_TTL_MS,
  DISMISSED,
  MAX_PINS_PER_USER,
  PINNED,
  REMOVED,
  partitionIssuePrefs,
  pinWouldExceedCap,
  surplusDismissalIds,
} from './redmine-prefs-core';

export { DISMISSED, PINNED, REMOVED } from './redmine-prefs-core';

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

/** Everything a preference row holds besides its owner. */
const PREF_FIELDS = { issueId: 1, state: 1, updatedAt: 1, dismissedAt: 1, assignedToMeAtDismissal: 1 };

/** The fields that make a pinned or removed row also hidden (rules 7 and 11). */
const HIDE_ON_PIN = { dismissedAt: '', assignedToMeAtDismissal: '' };

/** The states whose row can carry a hide as well (rules 7 and 11). */
const HIDE_CARRIERS = [PINNED, REMOVED];

/**
 * Lift the hide on these issues: a dismissal row goes, a pinned or removed row
 * keeps its state. Undo, Restore and the reassignment rule all mean "show it
 * again", never "unpin".
 */
async function clearHides(userId, issueIds) {
  const issueId = { $in: issueIds };
  await RedmineIssuePrefs.updateAsync(
    { userId, issueId, state: { $in: HIDE_CARRIERS } },
    { $unset: HIDE_ON_PIN },
    { multi: true },
  );
  await RedmineIssuePrefs.removeAsync({ userId, issueId, state: DISMISSED });
}

/**
 * Thrown when a pin would pass `MAX_PINS_PER_USER`.
 *
 * A plain Error, not a `Meteor.Error`: this module is the Mongo half and stays
 * out of the method layer's vocabulary, so the method translates it into the
 * code the client branches on. `name` is what the method matches.
 */
export class TooManyPinsError extends Error {
  constructor() {
    super(`You can pin at most ${MAX_PINS_PER_USER} Redmine issues.`);
    this.name = 'TooManyPinsError';
  }
}

/**
 * Record, replace or clear one preference.
 *
 * `state: null` lifts a hide — Undo in the dropdown and Restore in Settings are
 * the same call — and leaves a pin in place. `assignedToMe` is stored for a
 * dismissal only, and only so the reassignment rule can tell "I hid an issue
 * that was already mine" from "I hid an issue that later became mine".
 */
export async function setIssuePref(userId, issueId, state, { assignedToMe = true } = {}) {
  if (state === null) {
    await clearHides(userId, [issueId]);
  } else if (state === PINNED) {
    // Refused rather than evicting the user's oldest pin, which would take a
    // Tickets row and a My Board entry away without saying so.
    if (pinWouldExceedCap(await allPrefRows(userId), issueId)) {
      // The pin was asked for to bring the issue back, so a removal must not
      // outlive the refusal: one assigned to the user returns without a pin.
      await forgetRemovals(userId, [issueId]);
      bustUserCaches(userId);
      throw new TooManyPinsError();
    }
    // A pin replaces a dismissal, and clears a hide on an existing pin (rule 6).
    await RedmineIssuePrefs.upsertAsync(
      { userId, issueId },
      { $set: { userId, issueId, state, updatedAt: new Date() }, $unset: HIDE_ON_PIN },
    );
  } else {
    const held = await RedmineIssuePrefs.findOneAsync({ userId, issueId }, { fields: { state: 1 } });
    const hide = { assignedToMeAtDismissal: assignedToMe === true };
    if (HIDE_CARRIERS.includes(held?.state)) {
      // Rules 7 and 11: hide it, keep the pin or the removal.
      await RedmineIssuePrefs.updateAsync(
        { userId, issueId },
        { $set: { ...hide, dismissedAt: new Date() } },
      );
    } else {
      await RedmineIssuePrefs.upsertAsync(
        { userId, issueId },
        { $set: { userId, issueId, state, updatedAt: new Date(), ...hide } },
      );
      await trimDismissals(userId);
    }
  }
  // The relevant list is cached for 90 seconds and this changed what belongs in
  // it, so the next call must recompute rather than serve the pre-dismissal list.
  bustUserCaches(userId);
}

/**
 * Pin an issue, leaving an existing pin's date alone. Used by the timer-start
 * path, which fires on every start — rewriting `updatedAt` there would be pure
 * write noise, since a pin does not expire and its date carries no meaning.
 *
 * The cached relevant list is cleared either way: a timer just started, so the
 * issue's `running` signal changed even when its pin did not.
 */
export async function pinIssueIfUnset(userId, issueId) {
  const held = await RedmineIssuePrefs.findOneAsync(
    { userId, issueId },
    { fields: { state: 1, dismissedAt: 1 } },
  );
  // A hidden pin still needs the write: starting a timer lifts the hide (rule 6).
  if (held?.state === PINNED && held.dismissedAt == null) {
    bustUserCaches(userId);
    return;
  }
  await setIssuePref(userId, issueId, PINNED);
}

/**
 * This user's state for one issue — `pinned`, `dismissed`, `removed` or null.
 * A hidden pin reads as `pinned`: it is still a Tickets row (rule 7), and
 * starting its timer lifts the hide (`pinIssueIfUnset`).
 */
export async function issuePrefState(userId, issueId) {
  const held = await RedmineIssuePrefs.findOneAsync({ userId, issueId }, { fields: { state: 1 } });
  return held?.state ?? null;
}

/**
 * Take issues out of this user's Tickets table (bulk Delete). Nothing is sent
 * to Redmine.
 *
 * Each row becomes a removal, whatever it was (rule 8): a pin goes, since a pin
 * is what keeps an issue someone else owns in the table. A hide the row carried
 * is kept on the removal (rule 11), so removing an issue does not quietly bring
 * it back into the search suggestions. My Board entries are the caller's to drop.
 */
export async function removeIssuesFromTable(userId, issueIds) {
  const held = new Map(
    (
      await RedmineIssuePrefs.find(
        { userId, issueId: { $in: issueIds } },
        { fields: PREF_FIELDS },
      ).fetchAsync()
    ).map((row) => [row.issueId, row]),
  );
  const now = new Date();
  await Promise.all(
    issueIds.map((issueId) => {
      const hide = carriedHide(held.get(issueId));
      return RedmineIssuePrefs.upsertAsync(
        { userId, issueId },
        hide
          ? { $set: { userId, issueId, state: REMOVED, updatedAt: now, ...hide } }
          : { $set: { userId, issueId, state: REMOVED, updatedAt: now }, $unset: HIDE_ON_PIN },
      );
    }),
  );
  bustUserCaches(userId);
}

/** The hide a row holds, in the fields a pinned or removed row carries it in. */
function carriedHide(row) {
  if (row?.state === DISMISSED) {
    return { dismissedAt: row.updatedAt, assignedToMeAtDismissal: row.assignedToMeAtDismissal };
  }
  if (row?.dismissedAt != null) {
    return { dismissedAt: row.dismissedAt, assignedToMeAtDismissal: row.assignedToMeAtDismissal };
  }
  return null;
}

/**
 * Drop these removals (rule 10). A removal that carried a hide turns back into
 * the plain dismissal it was, dated as before, so the hide still expires on time.
 */
async function forgetRemovals(userId, issueIds) {
  const issueId = { $in: issueIds };
  // The raw driver, because copying `dismissedAt` into `updatedAt` needs an
  // update pipeline, which Meteor's `updateAsync` does not take. The delete
  // after it only matches removals still left, so the two steps cannot clash.
  await RedmineIssuePrefs.rawCollection().updateMany(
    { userId, issueId, state: REMOVED, dismissedAt: { $ne: null } },
    [{ $set: { state: DISMISSED, updatedAt: '$dismissedAt' } }, { $unset: 'dismissedAt' }],
  );
  await RedmineIssuePrefs.removeAsync({ userId, issueId, state: REMOVED });
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
    { fields: PREF_FIELDS },
  ).fetchAsync();
}

/**
 * This user's pins, live dismissals and removals, with rules 5 and 10 applied.
 *
 * One query, one decision: dismissals of issues now assigned to the user, and
 * removals of issues no longer assigned to them, are deleted here and are
 * already absent from the answer, so the caller gets a correct one without a
 * second read. `assignedIssueIds` comes from the relevant list's own "assigned
 * to me" signal, so the rules cost no extra Redmine call; `assignedKnown` says
 * that signal answered at all.
 */
export async function readIssuePrefs(
  userId,
  { assignedIssueIds = [], assignedKnown = false, now = Date.now() } = {},
) {
  const partitioned = partitionIssuePrefs(await allPrefRows(userId), {
    assignedIssueIds,
    assignedKnown,
    now,
  });
  if (partitioned.reviveIds.length) {
    await clearHides(userId, partitioned.reviveIds);
  }
  if (partitioned.forgetRemovalIds.length) {
    await forgetRemovals(userId, partitioned.forgetRemovalIds);
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
