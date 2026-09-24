/**
 * Redmine time-entry activity resolution (M4).
 *
 * Redmine rejects a time entry with no `activity_id`, and the target instance
 * has **no default** activity — it offers `Design` and `Development`, neither
 * flagged `is_default`. Omitting the id fails with `422 Activity cannot be
 * blank` on every write, so resolving one is a hard requirement, not a nicety.
 *
 * The id is resolved at runtime and never hardcoded: enumeration ids are
 * instance-specific and an admin can renumber them, which would silently log
 * time under the wrong activity with no signal.
 *
 * Kept free of Meteor imports so the shaping and fallback logic can be
 * unit-tested directly (see tests/redmine-activities.test.ts), matching
 * redmine-issues.js / redmine-status.js.
 */
import { listTimeEntryActivities } from './redmine-client';
import { createUserTtlCache } from './redmine-cache';

/**
 * The activity enumeration, per user, for an hour. It is instance-wide and
 * changes approximately never, while re-fetching it on every sync would add a
 * round trip to every write.
 */
const cache = createUserTtlCache(60 * 60 * 1000);

/**
 * Tracker name → activity name (D4). Matched case-insensitively, by **name**
 * on both sides: enumeration and tracker ids are instance-specific and an admin
 * can renumber either, so an id here would silently log under the wrong
 * activity.
 *
 * Every entry currently resolves to `Development`, and that is not an oversight.
 * redmine0 offers the trackers `Bug` / `Feature` / `Support` against the
 * activities `Design` / `Development`, and the two vocabularies answer different
 * questions — a tracker says *what kind of issue this is*, an activity says
 * *what kind of work you did on it*. All three trackers are engineering
 * categories, so the honest mapping is degenerate today. It earns its keep as
 * the seam: adding a design-oriented tracker becomes one line here rather than a
 * code change, and the per-row override in the push dialog covers the rest.
 */
const TRACKER_ACTIVITY = {
  bug: 'Development',
  feature: 'Development',
  support: 'Development',
};

/** Case-insensitive lookup of an activity by name. */
function findByName(activities, name) {
  const target = String(name).trim().toLowerCase();
  return activities.find((a) => a.name.trim().toLowerCase() === target) ?? null;
}

/**
 * The activity a tracker maps to, or null when the tracker is unknown or the
 * mapped activity does not exist on this instance.
 */
export function activityForTracker(activities, trackerName) {
  if (!Array.isArray(activities) || activities.length === 0) return null;
  if (trackerName == null || trackerName === '') return null;

  const wanted = TRACKER_ACTIVITY[String(trackerName).trim().toLowerCase()];
  return wanted ? findByName(activities, wanted) : null;
}

/** Shape a raw Redmine activity enumeration entry into our DTO. */
function toActivity(raw) {
  return {
    id: raw.id,
    name: raw.name ?? '',
    isDefault: raw.is_default === true,
  };
}

/**
 * Shape a raw `time_entry_activities` array into our DTO list.
 * Non-array input yields an empty list.
 */
export function toActivityList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry) => entry && entry.id != null).map(toActivity);
}

/**
 * Choose which activity to log time under.
 *
 * Order: the user's explicit choice (when it still exists in the enumeration) →
 * the issue's tracker (D4) → the instance default → one named "Development" →
 * the first → none. `reason` is returned so the UI can surface which rule fired
 * instead of choosing silently on the user's behalf — under D1 a logged entry is
 * permanent, so a wrong activity cannot be corrected afterwards.
 *
 * **Why the explicit choice outranks the tracker**, where the plan's first draft
 * had it the other way round: `TRACKER_ACTIVITY` is degenerate on this instance
 * (every tracker → `Development`), so tracker-first would swallow the user's
 * setting entirely and make the Settings control dead weight — a designer who
 * picked `Design` would still log `Development` on every issue. A deliberate
 * choice beats an inference; the tracker is the smart default for the user who
 * has not made one.
 *
 * @returns {{activity: object|null, reason: 'chosen'|'tracker'|'is_default'|'named'|'first'|'none'}}
 */
export function pickDefaultActivity(activities, chosenId, trackerName) {
  if (!Array.isArray(activities) || activities.length === 0) {
    return { activity: null, reason: 'none' };
  }

  const chosen = chosenId == null ? null : activities.find((a) => a.id === chosenId);
  if (chosen) return { activity: chosen, reason: 'chosen' };

  const fromTracker = activityForTracker(activities, trackerName);
  if (fromTracker) return { activity: fromTracker, reason: 'tracker' };

  const flagged = activities.find((a) => a.isDefault);
  if (flagged) return { activity: flagged, reason: 'is_default' };

  const named = findByName(activities, 'Development');
  if (named) return { activity: named, reason: 'named' };

  return { activity: activities[0], reason: 'first' };
}

/**
 * The activity enumeration visible to `account`'s key, served from cache when fresh.
 * Only successful fetches are cached, so a transient failure is retried.
 */
export function getActivitiesForUser(userId, account) {
  return cache.get(userId, 'activities', async () =>
    toActivityList(await listTimeEntryActivities(account)),
  );
}
