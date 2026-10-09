/**
 * Redmine time-entry activity resolution.
 *
 * Redmine rejects a time entry with no `activity_id`, and the target instance
 * has **no default** activity — it offers `Design` and `Development`, neither
 * flagged `is_default`. Omitting the id fails with `422 Activity cannot be
 * blank` on every write, so resolving one is a hard requirement, not a nicety.
 *
 * The id is resolved at runtime and never hardcoded: enumeration ids are
 * instance-specific and an admin can renumber them, which would silently log
 * time under the wrong activity with no signal.
 */
import {
  listProjectTimeEntryActivities,
  listTimeEntryActivities,
  mapInChunks,
} from './redmine-client';
import { createUserTtlCache } from './redmine-cache';

/**
 * The activity enumeration and each project's allowed activities, per user, for
 * an hour. Both change approximately never, while re-fetching them on every sync
 * would add a round trip per project to every write.
 */
const cache = createUserTtlCache(60 * 60 * 1000);

/**
 * Tracker name → activity name. Matched case-insensitively, by **name**
 * on both sides: enumeration and tracker ids are instance-specific and an admin
 * can renumber either, so an id here would silently log under the wrong
 * activity.
 *
 * Every entry currently resolves to `Development`, and that is not an oversight:
 * a tracker says *what kind of issue this is*, an activity *what kind of work
 * you did on it*, and all three trackers are engineering categories, so the
 * honest mapping is degenerate today. It earns its keep as the seam: adding a
 * design-oriented tracker becomes one line here rather than a code change, and
 * the per-row override in the push dialog covers the rest.
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

/** Shape a raw Redmine activity into our DTO. */
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
 *
 * Inactive activities are left out: Redmine refuses an entry under one, so they
 * are never offered. Only an explicit `active: false` marks one inactive; a
 * project's list and older Redmine versions omit the flag.
 */
export function toActivityList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry) => entry && entry.id != null && entry.active !== false).map(toActivity);
}

/**
 * Shape a project's raw `time_entry_activities` into our DTO list. Redmine lists
 * only the ones the project allows, by id and name, so `isDefault` is carried
 * over from the instance's `enumeration`: by id, else by name, because a project
 * that overrides an activity gets its own copy under a new id and the same name.
 *
 * Returns null when the project did not say (an older Redmine ignores the
 * include), which is not the same as a project that allows none.
 */
export function toProjectActivities(raw, enumeration) {
  if (!Array.isArray(raw)) return null;
  return toActivityList(raw).map((activity) => ({
    ...activity,
    isDefault:
      (enumeration.find((a) => a.id === activity.id) ?? findByName(enumeration, activity.name))
        ?.isDefault ?? false,
  }));
}

/**
 * Choose which activity to log time under.
 *
 * `activities` is what the issue's project allows. Order: the issue's tracker →
 * the instance default → one named "Development" → the first → none. This is
 * only the starting point: the push dialog shows it on the row and lets the
 * user change it, because a logged entry is permanent and a wrong activity
 * cannot be corrected afterwards. `reason` says which rule fired.
 *
 * @returns {{activity: object|null, reason: 'tracker'|'is_default'|'named'|'first'|'none'}}
 */
export function pickDefaultActivity(activities, trackerName) {
  if (!Array.isArray(activities) || activities.length === 0) {
    return { activity: null, reason: 'none' };
  }

  const fromTracker = activityForTracker(activities, trackerName);
  if (fromTracker) return { activity: fromTracker, reason: 'tracker' };

  const flagged = activities.find((a) => a.isDefault);
  if (flagged) return { activity: flagged, reason: 'is_default' };

  const named = findByName(activities, 'Development');
  if (named) return { activity: named, reason: 'named' };

  return { activity: activities[0], reason: 'first' };
}

/**
 * The instance's active activities visible to `account`'s key, served from cache
 * when fresh. Only successful fetches are cached, so a transient failure is retried.
 */
export function getActivitiesForUser(userId, account) {
  return cache.get(userId, 'activities', async () =>
    toActivityList(await listTimeEntryActivities(account)),
  );
}

/**
 * The activities one project allows, read once per project and then served from
 * cache, so a push costs one call per project however many issues share it.
 *
 * A project whose list cannot be read falls back to the instance's
 * `enumeration`, which is what was offered before projects were consulted.
 * Redmine still has the last word on the entry, and blocking the row would stop
 * time that it may well accept.
 */
async function getProjectActivities(userId, account, projectId, enumeration) {
  try {
    const allowed = await cache.get(userId, `project-activities|${projectId}`, async () =>
      toProjectActivities(await listProjectTimeEntryActivities(account, projectId), enumeration),
    );
    if (allowed) return allowed;
  } catch {
    /* unreadable: fall back below */
  }
  return enumeration;
}

/** How many projects are asked for their activities at a time. */
const PROJECT_CONCURRENCY = 5;

/**
 * The allowed activities of each project in `projectIds`, read a few at a time:
 * a burst that Redmine refused would put those projects on the instance-wide
 * fallback, which is the list this lookup exists to narrow.
 * @returns {Promise<Map<number, Array>>} keyed by project id
 */
export async function getActivitiesByProject(userId, account, projectIds, enumeration) {
  const lists = await mapInChunks(projectIds, PROJECT_CONCURRENCY, (projectId) =>
    getProjectActivities(userId, account, projectId, enumeration),
  );
  return new Map(projectIds.map((projectId, index) => [projectId, lists[index]]));
}
