/**
 * Redmine account linking (Milestone 1).
 *
 * A TimeHuddle user links their personal Redmine account by pasting their API
 * key. We validate it against `GET /users/current.json`, then store one
 * `redmine_links` row per user with the key encrypted at rest. The key is never
 * returned to the client or logged.
 *
 * Any Redmine account can be linked to any TimeHuddle account: the key alone
 * identifies the Redmine user, so there is no email matching or admin step.
 */
import { Meteor } from 'meteor/meteor';

import { ClockEvents, RedmineLinks, Timers } from './collections';
import { requireIdentity } from './auth-bridge';
import {
  createTimeEntry,
  getCurrentUser,
  getTimeEntry,
  listIssues,
  listIssuesByIds,
  optionalRedmineBaseUrl,
  redmineBaseUrl,
} from './redmine-client';
import { encryptSecret, envKey } from './redmine-crypto';
import { findRedmineApiKey } from './redmine-account';
import { toStatus } from './redmine-status';
import { toIssueList } from './redmine-issues';
import { bustActivityCache, getActivitiesForUser, pickDefaultActivity } from './redmine-activities';
import { buildPushRows, PUSH_COMMENT } from './redmine-time-entries';
import { recordFailure, recordSynced, syncedKeysFor } from './redmine-time-sync';
import { redmineTicketDaysFor } from './timer-core';

const VALID_SCOPES = new Set(['mine', 'all']);

const DUPLICATE_KEY_ERROR_CODE = 11000;

/**
 * Map a failed Redmine request onto the Meteor error the client expects.
 * A rejected key is actionable ("re-link in Settings"); anything else is not
 * worth distinguishing, so it collapses to "unreachable".
 */
function toRedmineMeteorError(err) {
  if (err?.status === 401 || err?.status === 403) {
    return new Meteor.Error('invalid-key', 'Your Redmine API key was rejected.');
  }
  return new Meteor.Error(
    'unreachable',
    'Could not reach Redmine. Check the server URL and that the REST API is enabled.',
  );
}

// Enforce the "one link per user" invariant at the storage layer so concurrent
// first-time `redmine.connect` calls can't both insert (Mongo `_id` uniqueness
// alone doesn't guard the `userId` upsert key). Mirrors the unique-index pattern
// in org-helpers.js used for the same concurrent-upsert race.
Meteor.startup(async () => {
  try {
    await RedmineLinks.createIndexAsync({ userId: 1 }, { unique: true, name: 'unique_redmine_link_user' });
  } catch (error) {
    console.error('[redmine] failed to create unique userId index:', error);
  }
});

/**
 * Whether the caller is idle enough to push (D2).
 *
 * Both halves matter. An open shift means the day is not finished, and a
 * running ticket session has no final duration — under D1 either would write a
 * partial total that can never be corrected.
 */
async function isIdleForPush(userId) {
  const openShift = await ClockEvents.findOneAsync({ userId, endTime: null });
  if (openShift) return false;
  const runningTimer = await Timers.findOneAsync({ userId, endTime: null });
  return !runningTimer;
}

/**
 * The unsynced ticket-days for a user, shaped for the dialog.
 *
 * Shared by `preview` and `push` so the two can never disagree about what is
 * eligible — `push` re-derives this rather than trusting what the client sends.
 */
async function buildPreviewRows(userId, apiKey) {
  const totals = await redmineTicketDaysFor(userId);
  if (!totals.length) return [];

  const alreadySynced = await syncedKeysFor(userId);
  const unsynced = totals.filter(
    (total) => !alreadySynced.has(`${total.ticketId}|${total.date}`),
  );
  if (!unsynced.length) return [];

  const issueIds = [...new Set(unsynced.map((total) => total.ticketId))];

  // A Redmine outage must not blank the dialog: without issue detail every row
  // is reported as `issue-unavailable`, which is the truth rather than silence.
  let issuesById = new Map();
  let activities = [];
  try {
    const [issues, fetchedActivities] = await Promise.all([
      listIssuesByIds(apiKey, issueIds),
      getActivitiesForUser(userId, apiKey),
    ]);
    issuesById = new Map(
      issues.map((issue) => [
        String(issue.id),
        { subject: issue.subject ?? '', trackerName: issue.tracker?.name ?? null },
      ]),
    );
    activities = fetchedActivities;
  } catch {
    /* fall through with empty maps */
  }

  const link = await RedmineLinks.findOneAsync({ userId }, { fields: { defaultActivityId: 1 } });
  const chosenId = link?.defaultActivityId ?? null;

  const resolveActivity = (trackerName) => {
    const { activity, reason } = pickDefaultActivity(activities, chosenId, trackerName);
    return {
      activityId: activity?.id ?? null,
      activityName: activity?.name ?? null,
      reason,
    };
  };

  return buildPushRows(unsynced, issuesById, resolveActivity);
}

/**
 * Create one entry, confirm it by reading it back, and record the outcome.
 *
 * The read-back is not ceremony: Redmine can answer `201` while storing
 * something other than what was sent, and under D1 there is no second chance to
 * correct it — so a mismatch is surfaced rather than assumed away.
 */
async function pushOneEntry(userId, apiKey, row, activityId) {
  const base = { ticketId: row.ticketId, date: row.date, hours: row.hours };

  let created;
  try {
    created = await createTimeEntry(apiKey, {
      issueId: Number(row.ticketId),
      hours: row.hours,
      activityId,
      spentOn: row.date,
      comments: PUSH_COMMENT,
    });
  } catch (err) {
    // 403 here is the signature of a role without `log_time`, which is a
    // different user action from "Redmine was unreachable".
    const reason =
      err?.status === 403
        ? 'no-log-time-permission'
        : err?.status === 422
          ? 'rejected-by-redmine'
          : 'unreachable';
    await recordFailure(userId, row.ticketId, row.date, reason);
    return { ...base, ok: false, reason };
  }

  const entryId = created?.id ?? null;
  if (entryId == null) {
    await recordFailure(userId, row.ticketId, row.date, 'no-entry-id');
    return { ...base, ok: false, reason: 'no-entry-id' };
  }

  // Store the id before confirming: if the read-back fails, the entry still
  // exists in Redmine, and forgetting its id is what would produce a duplicate
  // on the next push.
  await recordSynced(userId, row.ticketId, row.date, {
    redmineTimeEntryId: entryId,
    hours: row.hours,
  });

  const stored = await getTimeEntry(apiKey, entryId);
  if (stored && Number(stored.hours) !== row.hours) {
    await recordFailure(userId, row.ticketId, row.date, 'hours-mismatch');
    return { ...base, ok: false, reason: 'hours-mismatch', storedHours: Number(stored.hours), entryId };
  }

  return { ...base, ok: true, entryId };
}

Meteor.methods({
  /**
   * Validate a personal Redmine API key and link it to the calling user.
   * Upsert is keyed on `userId`, so reconnecting with a different key re-links.
   */
  async 'redmine.connect'({ apiKey } = {}) {
    const { userId } = await requireIdentity(this);

    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Meteor.Error('bad-request', 'A Redmine API key is required.');
    }
    const key = apiKey.trim();

    let baseUrl;
    try {
      baseUrl = redmineBaseUrl();
    } catch {
      throw new Meteor.Error('not-configured', 'Redmine is not configured on the server.');
    }

    let user;
    try {
      user = await getCurrentUser(key);
    } catch (err) {
      if (err?.status === 401 || err?.status === 403) {
        throw new Meteor.Error('invalid-key', 'That API key was rejected by Redmine.');
      }
      throw new Meteor.Error(
        'unreachable',
        'Could not reach Redmine. Check the server URL and that the REST API is enabled.',
      );
    }
    if (!user) {
      throw new Meteor.Error('invalid-key', 'That API key was rejected by Redmine.');
    }

    // `baseUrl` is intentionally NOT persisted: the configured instance is the
    // single source of truth, derived at read time in `toStatus`.
    const update = {
      $set: {
        userId,
        redmineUserId: user.id,
        redmineLogin: user.login,
        firstname: user.firstname ?? '',
        lastname: user.lastname ?? '',
        mail: user.mail ?? '',
        apiKey: encryptSecret(key, envKey()),
        linkedAt: new Date(),
      },
    };
    try {
      await RedmineLinks.upsertAsync({ userId }, update);
    } catch (err) {
      // Lost a concurrent first-insert race against the unique userId index;
      // the row now exists, so retry as a plain update.
      if (err?.code === DUPLICATE_KEY_ERROR_CODE) {
        await RedmineLinks.updateAsync({ userId }, update);
      } else {
        throw err;
      }
    }

    return toStatus(await RedmineLinks.findOneAsync({ userId }), baseUrl);
  },

  /** Remove the caller's Redmine link. */
  async 'redmine.disconnect'() {
    const { userId } = await requireIdentity(this);
    await RedmineLinks.removeAsync({ userId });
    // Re-linking with a key for a different Redmine account must not be served
    // the previous instance's activity list.
    bustActivityCache(userId);
    return { connected: false };
  },

  /** Report the caller's Redmine connection status (never the key). */
  async 'redmine.status'() {
    const { userId } = await requireIdentity(this);
    return toStatus(await RedmineLinks.findOneAsync({ userId }), optionalRedmineBaseUrl());
  },

  /**
   * List the caller's Redmine issues (read-only) using their stored API key.
   * `scope: 'mine'` → assigned to me; `scope: 'all'` → everything the key can see.
   * Returns `{ connected: false, issues: [] }` when the user has no link, so the
   * view can render its "not connected" state without a separate round-trip.
   */
  async 'redmine.issues.list'({ scope = 'mine' } = {}) {
    const { userId } = await requireIdentity(this);
    if (!VALID_SCOPES.has(scope)) {
      throw new Meteor.Error('bad-request', 'scope must be "mine" or "all".');
    }

    const apiKey = await findRedmineApiKey(userId);
    if (!apiKey) return { connected: false, baseUrl: optionalRedmineBaseUrl(), issues: [] };

    const baseUrl = optionalRedmineBaseUrl();

    let issues;
    try {
      issues = await listIssues(apiKey, { scope });
    } catch (err) {
      throw toRedmineMeteorError(err);
    }

    return { connected: true, baseUrl, issues: toIssueList(issues) };
  },

  /**
   * The instance's time-entry activities, plus which one the caller's time will
   * be logged under and why.
   *
   * Returns `{ connected: false, activities: [] }` for an unlinked user so
   * Settings can render its state without a second round-trip, matching
   * `redmine.issues.list`. An empty `activities` on a connected account means
   * the instance has none configured and cannot receive time at all.
   */
  async 'redmine.activities.list'() {
    const { userId } = await requireIdentity(this);

    const apiKey = await findRedmineApiKey(userId);
    if (!apiKey) return { connected: false, activities: [], selectedId: null, selectedReason: 'none' };

    let activities;
    try {
      activities = await getActivitiesForUser(userId, apiKey);
    } catch (err) {
      throw toRedmineMeteorError(err);
    }

    const link = await RedmineLinks.findOneAsync({ userId }, { fields: { defaultActivityId: 1 } });
    const { activity, reason } = pickDefaultActivity(activities, link?.defaultActivityId ?? null);

    return {
      connected: true,
      activities,
      selectedId: activity?.id ?? null,
      selectedReason: reason,
    };
  },

  /**
   * Persist the caller's preferred activity onto their `redmine_links` row —
   * already the per-user Redmine config surface, so no new collection.
   *
   * The id is validated against the live enumeration so a stale client cannot
   * store one the instance does not have.
   */
  async 'redmine.activities.setDefault'({ activityId } = {}) {
    const { userId } = await requireIdentity(this);

    if (!Number.isInteger(activityId)) {
      throw new Meteor.Error('bad-request', 'An activity id is required.');
    }

    const apiKey = await findRedmineApiKey(userId);
    if (!apiKey) {
      throw new Meteor.Error('not-connected', 'Connect your Redmine account first.');
    }

    let activities;
    try {
      activities = await getActivitiesForUser(userId, apiKey);
    } catch (err) {
      throw toRedmineMeteorError(err);
    }

    if (!activities.some((a) => a.id === activityId)) {
      throw new Meteor.Error('bad-request', 'That activity does not exist on this Redmine instance.');
    }

    await RedmineLinks.updateAsync({ userId }, { $set: { defaultActivityId: activityId } });

    const { activity, reason } = pickDefaultActivity(activities, activityId);
    return {
      connected: true,
      activities,
      selectedId: activity?.id ?? null,
      selectedReason: reason,
    };
  },

  /**
   * What a push would send, for the confirmation dialog (M5, D2).
   *
   * Pure read — it creates nothing in Redmine. Rows that cannot be sent are
   * still returned, carrying a `blockedReason`, so the dialog can explain the
   * omission rather than quietly showing a shorter list than the user's day.
   */
  async 'redmine.timeEntries.preview'() {
    const { userId } = await requireIdentity(this);

    const apiKey = await findRedmineApiKey(userId);
    if (!apiKey) return { connected: false, idle: true, rows: [], baseUrl: optionalRedmineBaseUrl() };

    const idle = await isIdleForPush(userId);
    const rows = await buildPreviewRows(userId, apiKey);
    return { connected: true, idle, rows, baseUrl: optionalRedmineBaseUrl() };
  },

  /**
   * Create one Redmine time entry per confirmed ticket-day (M5, D1 + D2).
   *
   * **The only write this integration performs, and it is irreversible.** The
   * client says *which* ticket-days to send and may override the activity; it
   * never supplies the hours. Those are recomputed here from the timer
   * sessions, because a client-supplied number would let a stale or tampered
   * dialog write a figure nobody worked.
   */
  async 'redmine.timeEntries.push'({ entries = [] } = {}) {
    const { userId } = await requireIdentity(this);

    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Meteor.Error('bad-request', 'Nothing to send.');
    }

    const apiKey = await findRedmineApiKey(userId);
    if (!apiKey) {
      throw new Meteor.Error('not-connected', 'Connect your Redmine account first.');
    }

    // The same gate the button enforces, re-checked server-side: a timer that
    // started after the dialog opened would otherwise have its partial total
    // written permanently.
    if (!(await isIdleForPush(userId))) {
      throw new Meteor.Error(
        'not-idle',
        'Clock out and stop every ticket timer before sending time to Redmine.',
      );
    }

    // Recomputed server-side, then matched against the requested rows.
    const previewRows = await buildPreviewRows(userId, apiKey);
    const byKey = new Map(previewRows.map((row) => [`${row.ticketId}|${row.date}`, row]));

    // The same enumeration the rows were resolved from, served from cache. If it
    // cannot be fetched the set stays empty, so every override is rejected as
    // unverifiable rather than trusted.
    let validActivityIds = new Set();
    try {
      validActivityIds = new Set((await getActivitiesForUser(userId, apiKey)).map((a) => a.id));
    } catch {
      /* unreachable — handled per row below */
    }

    const results = [];
    for (const requested of entries) {
      const key = `${requested?.ticketId}|${requested?.date}`;
      const row = byKey.get(key);

      if (!row) {
        results.push({
          ticketId: requested?.ticketId ?? null,
          date: requested?.date ?? null,
          ok: false,
          reason: 'already-synced-or-gone',
        });
        continue;
      }
      if (row.blockedReason) {
        results.push({ ticketId: row.ticketId, date: row.date, ok: false, reason: row.blockedReason });
        continue;
      }

      // An override is honoured only if this instance really has that activity,
      // matching the check `redmine.activities.setDefault` makes. An invalid one
      // rejects the row instead of falling back to the default: under D1 the
      // entry is permanent, and writing an activity the user did not choose is
      // worse than writing nothing.
      let activityId = row.activityId;
      if (requested.activityId != null) {
        if (!Number.isInteger(requested.activityId) || !validActivityIds.has(requested.activityId)) {
          results.push({ ticketId: row.ticketId, date: row.date, ok: false, reason: 'invalid-activity' });
          continue;
        }
        activityId = requested.activityId;
      }

      results.push(await pushOneEntry(userId, apiKey, row, activityId));
    }

    return { results };
  },
});
