/**
 * Redmine account linking.
 *
 * A TimeHuddle user links their personal Redmine account by pasting their API
 * key. We validate it against `GET /users/current.json`, then store one
 * `redmine_links` row per user with the key encrypted at rest. The key is never
 * returned to the client or logged.
 *
 * Any Redmine account can be linked to any TimeHuddle account: the key alone
 * identifies the Redmine user, so there is no email matching or admin step.
 */
import { randomUUID } from 'node:crypto';

import { Meteor } from 'meteor/meteor';

import { ClockEvents, DUPLICATE_KEY_ERROR_CODE, RedmineLinks, Timers } from './collections';
import { requireIdentity } from './auth-bridge';
import {
  createTimeEntry,
  getCurrentUser,
  getTimeEntry,
  isRedmineBudgetExhausted,
  isRedmineTimeout,
  listIssuesByIds,
  customRedmineUrlAllowed,
  linkedRedmineBaseUrl,
  normalizeRedmineUrl,
  optionalRedmineBaseUrl,
  redmineUrlRefusal,
} from './redmine-client';
import { encryptSecret, envKey } from './redmine-crypto';
import {
  findRedmineAccount,
  requireRedmineAccount,
  tooManyRedmineRequests,
} from './redmine-account';
import { toStatus } from './redmine-status';
import { getActivitiesForUser, pickDefaultActivity } from './redmine-activities';
import { bustUserCaches } from './redmine-cache';
import { createRateLimiter } from './rate-limit';
import { removeUserIssuePrefs } from './redmine-prefs';
import { buildPushRows, hoursAgree, PUSH_COMMENT, unsentTotals } from './redmine-time-entries';
import { flagEntry, pushLedgerFor, recordDiscard, recordEntry } from './redmine-time-sync';
import { ticketDayKey } from './redmine-net-hours';
import { redmineTicketDaysFor } from './timer-core';

/**
 * Count this call against `limiter` (see rate-limit.js), or refuse it with
 * `too-many-requests`. Every Redmine method that a client could call in a loop
 * is metered, because an unmetered loop there is an unmetered loop against Redmine.
 */
export function enforceRedmineLimit(limiter, userId) {
  const { allowed, retryAfterMs } = limiter.check(userId);
  if (!allowed) throw tooManyRedmineRequests(retryAfterMs);
}


/**
 * What one user may ask of the account, activity and push methods below. Each
 * can reach Redmine, and none is called more than a few times a minute by a
 * person using the app, so one shared, generous bound covers them.
 */
const accountLimiter = createRateLimiter({ limit: 60, windowMs: 60 * 1000 });

/**
 * Map a failed Redmine request onto the Meteor error the client expects.
 * A rejected key is actionable ("re-link in Settings"); a timeout is told as
 * one, so a slow Redmine is not mistaken for a misconfigured one; anything else
 * collapses to "unreachable". Timeouts keep the `unreachable` code, so callers
 * that branch on it need no change.
 *
 * Nothing is logged here. The failure is logged where it happens, in
 * `redmineRequest`, which knows what must stay out of the log.
 */
export function toRedmineMeteorError(err) {
  if (isRedmineBudgetExhausted(err)) return tooManyRedmineRequests();
  if (err?.status === 401 || err?.status === 403) {
    return new Meteor.Error('invalid-key', 'Your Redmine API key was rejected.');
  }
  if (isRedmineTimeout(err)) {
    return new Meteor.Error('unreachable', 'Redmine took too long to respond. Try again in a moment.');
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

// Redmine is on when a base URL is set, and every personal key is encrypted with
// REDMINE_ENCRYPTION_KEY. Without it the first connect fails with a 500, so refuse
// to boot instead.
Meteor.startup(() => {
  if (optionalRedmineBaseUrl() && !process.env.REDMINE_ENCRYPTION_KEY) {
    throw new Error('REDMINE_BASE_URL is set but REDMINE_ENCRYPTION_KEY is not.');
  }
});

/**
 * The caller's connection status, plus what Settings needs to offer a custom
 * Redmine URL: whether the deployment allows one, and the server default to
 * prefill it with.
 */
function statusFor(link) {
  return {
    ...toStatus(link, link ? linkedRedmineBaseUrl(link.baseUrl) : null),
    customUrlAllowed: customRedmineUrlAllowed(),
    defaultBaseUrl: optionalRedmineBaseUrl(),
  };
}

/**
 * The instance a `redmine.connect` call links to: the requested URL when custom
 * URLs are allowed and one was sent, otherwise the server's.
 */
function requestedBaseUrl(rawBaseUrl) {
  if (!customRedmineUrlAllowed() || rawBaseUrl == null || rawBaseUrl === '') {
    const fallback = optionalRedmineBaseUrl();
    if (!fallback) throw new Meteor.Error('not-configured', 'Redmine is not configured on the server.');
    return fallback;
  }
  const baseUrl = normalizeRedmineUrl(rawBaseUrl);
  if (!baseUrl) {
    throw new Meteor.Error('bad-request', 'Enter the Redmine URL as http(s)://host[/path].');
  }
  // Refused at link time as well as per request, so a user who cannot be served
  // is told why while they are looking at the field, rather than meeting
  // "Redmine is unreachable" on the Tickets page later.
  const refusal = redmineUrlRefusal(baseUrl);
  if (refusal) throw new Meteor.Error('bad-request', `${refusal}.`);
  return baseUrl;
}

/** Whether the caller is clocked in (their main clock has an open shift). */
async function hasOpenShift(userId) {
  return Boolean(await ClockEvents.findOneAsync({ userId, endTime: null }));
}

/**
 * Whether the caller is idle enough to push.
 *
 * Both halves matter. An open shift means the day is not finished, and a
 * running ticket session has no final duration — entries are create-only, so
 * either would write a partial total that can never be corrected.
 */
async function isIdleForPush(userId) {
  if (await hasOpenShift(userId)) return false;
  const runningTimer = await Timers.findOneAsync({ userId, endTime: null });
  return !runningTimer;
}

/**
 * A lock not renewed for this long is treated as abandoned (a crashed push). A
 * running push renews it before every entry, and one entry is two requests with
 * an 8-second timeout each, so a live push never comes near it.
 */
const PUSH_LOCK_STALE_MS = 2 * 60 * 1000;

/**
 * Claim the caller's push lock, returning the owner token that renews and
 * releases it, or null if a push is already running.
 *
 * A ticket-day may take several entries, so the storage layer does not reject
 * a second one. Without this, two tabs pressing Send together would both
 * compute the same unsent time and both create an entry for it. The claim is a
 * single atomic update on the caller's `redmine_links` row, so exactly one of
 * two concurrent pushes wins.
 */
async function acquirePushLock(userId) {
  const now = new Date();
  const owner = randomUUID();
  const claimed = await RedmineLinks.updateAsync(
    {
      userId,
      $or: [
        { pushingSince: null },
        { pushingSince: { $exists: false } },
        { pushingSince: { $lt: new Date(now.getTime() - PUSH_LOCK_STALE_MS) } },
      ],
    },
    { $set: { pushingSince: now, pushLockOwner: owner } },
  );
  return claimed === 1 ? owner : null;
}

/**
 * Extend the lease, or return false when this push no longer holds the lock.
 * Matched on the owner token, so a push that lost its lock cannot extend — or,
 * in `releasePushLock`, clear — the one that took over.
 */
async function renewPushLock(userId, owner) {
  const renewed = await RedmineLinks.updateAsync(
    { userId, pushLockOwner: owner },
    { $set: { pushingSince: new Date() } },
  );
  return renewed === 1;
}

function releasePushLock(userId, owner) {
  return RedmineLinks.updateAsync(
    { userId, pushLockOwner: owner },
    { $set: { pushingSince: null, pushLockOwner: null } },
  );
}

/**
 * Run `work` holding the caller's push lock, or refuse with `push-in-progress`.
 * `work` is handed a `stillHeld()` to call before each write to Redmine.
 */
async function withPushLock(userId, work) {
  const owner = await acquirePushLock(userId);
  if (!owner) {
    throw new Meteor.Error(
      'push-in-progress',
      'A push to Redmine is already running. Wait for it to finish, then try again.',
    );
  }
  try {
    return await work(() => renewPushLock(userId, owner));
  } finally {
    await releasePushLock(userId, owner);
  }
}

/** The activity enumeration, with a Redmine failure mapped for the client. */
async function activitiesOrMeteorError(userId, account) {
  try {
    return await getActivitiesForUser(userId, account);
  } catch (err) {
    throw toRedmineMeteorError(err);
  }
}

/** What both activity methods answer: the list, and which one applies and why. */
function activitySelection(activities, chosenId) {
  const { activity, reason } = pickDefaultActivity(activities, chosenId);
  return {
    connected: true,
    activities,
    selectedId: activity?.id ?? null,
    selectedReason: reason,
  };
}

/**
 * The unsynced ticket-days for a user, shaped for the dialog.
 *
 * Shared by `preview` and `push` so the two can never disagree about what is
 * eligible — `push` re-derives this rather than trusting what the client sends.
 */
async function buildPreviewRows(userId, account) {
  const totals = await redmineTicketDaysFor(userId);
  if (!totals.length) return [];

  // Only the time not already covered by earlier entries.
  const unsynced = unsentTotals(totals, await pushLedgerFor(userId));
  if (!unsynced.length) return [];

  const issueIds = [...new Set(unsynced.map((total) => total.ticketId))];

  // A Redmine outage must not blank the dialog: without issue detail every row
  // is reported as `issue-unavailable`, which is the truth rather than silence.
  let issuesById = new Map();
  let activities = [];
  try {
    const [issues, fetchedActivities] = await Promise.all([
      listIssuesByIds(account, issueIds),
      getActivitiesForUser(userId, account),
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
 * something other than what was sent, and a create-only entry leaves no second
 * chance to correct it — so a mismatch is surfaced rather than assumed away. The
 * comparison allows a minute of slack (`hoursAgree`), because Redmine keeps
 * time to the minute; a larger gap means it stored something else entirely.
 */
async function pushOneEntry(userId, account, row, activityId) {
  const base = { ticketId: row.ticketId, date: row.date, hours: row.hours };

  let created;
  try {
    created = await createTimeEntry(account, {
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
    // Nothing was created, so nothing is recorded: the time stays unsent and
    // is offered again on the next push. A 422 carries Redmine's own validation
    // messages ("Activity is not included in the list"), which say what to fix.
    const detail = reason === 'rejected-by-redmine' && err?.errors?.length ? err.errors : undefined;
    return { ...base, ok: false, reason, ...(detail ? { detail } : {}) };
  }

  const entryId = created?.id ?? null;
  if (entryId == null) {
    return { ...base, ok: false, reason: 'no-entry-id' };
  }

  // Record before confirming: if the read-back fails, the entry still exists in
  // Redmine, and forgetting it is what would resend the same time as a duplicate.
  await recordEntry(userId, row.ticketId, row.date, {
    redmineTimeEntryId: entryId,
    seconds: row.seconds,
    hours: row.hours,
  });

  // A read-back that fails, or that Redmine will not show this key, confirms
  // nothing. The entry stays recorded as sent, and the user is told it went
  // unconfirmed rather than that it was verified.
  const stored = await getTimeEntry(account, entryId).catch(() => null);
  if (!stored) {
    await flagEntry(entryId, 'unconfirmed');
    return { ...base, ok: false, reason: 'unconfirmed', entryId };
  }
  if (!hoursAgree(row.hours, Number(stored.hours))) {
    await flagEntry(entryId, 'hours-mismatch');
    return { ...base, ok: false, reason: 'hours-mismatch', storedHours: Number(stored.hours), entryId };
  }

  return { ...base, ok: true, entryId };
}

Meteor.methods({
  /**
   * Validate a personal Redmine API key and link it to the calling user.
   * Upsert is keyed on `userId`, so reconnecting with a different key re-links.
   */
  async 'redmine.connect'({ apiKey, baseUrl: rawBaseUrl } = {}) {
    const { userId } = await requireIdentity(this);
    enforceRedmineLimit(accountLimiter, userId);

    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Meteor.Error('bad-request', 'A Redmine API key is required.');
    }
    const key = apiKey.trim();

    const baseUrl = requestedBaseUrl(rawBaseUrl);
    const existing = await RedmineLinks.findOneAsync({ userId });

    // Issue ids mean nothing across instances, so the instance may only change
    // between shifts. Compared against the default when unlinked, so
    // disconnecting mid-shift is not a way around it.
    const currentBaseUrl = linkedRedmineBaseUrl(existing?.baseUrl);
    if (baseUrl !== currentBaseUrl && (await hasOpenShift(userId))) {
      throw new Meteor.Error('clocked-in', 'Clock out before switching to a different Redmine URL.');
    }

    let user;
    try {
      user = await getCurrentUser({ userId, apiKey: key, baseUrl });
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

    // The instance is part of the credential — a key only works where it was
    // issued — so a custom URL is stored with it. Without one the row carries no
    // URL and follows `REDMINE_BASE_URL`.
    const fields = {
      userId,
      redmineUserId: user.id,
      redmineLogin: user.login,
      firstname: user.firstname ?? '',
      lastname: user.lastname ?? '',
      mail: user.mail ?? '',
      apiKey: encryptSecret(key, envKey()),
      linkedAt: new Date(),
    };
    const update = customRedmineUrlAllowed()
      ? { $set: { ...fields, baseUrl } }
      : { $set: fields, $unset: { baseUrl: '' } };
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

    // A new key, or a new instance, must not be served the previous one's
    // activities, projects or members.
    bustUserCaches(userId);

    return statusFor(await RedmineLinks.findOneAsync({ userId }));
  },

  /** Remove the caller's Redmine link. */
  async 'redmine.disconnect'() {
    const { userId } = await requireIdentity(this);
    await RedmineLinks.removeAsync({ userId });
    // Pins and dismissals are issue ids from one instance, and mean nothing on
    // another — a stale pin would resolve to whatever issue happens to hold that
    // number next. Unlinking is also how a user says "forget my Redmine data".
    await removeUserIssuePrefs(userId);
    // Re-linking with a key for a different Redmine account must not be served
    // the previous account's activities, projects or members.
    bustUserCaches(userId);
    return statusFor(null);
  },

  /** Report the caller's Redmine connection status (never the key). */
  async 'redmine.status'() {
    const { userId } = await requireIdentity(this);
    return statusFor(await RedmineLinks.findOneAsync({ userId }));
  },

  /**
   * The instance's time-entry activities, plus which one the caller's time will
   * be logged under and why.
   *
   * Returns `{ connected: false, activities: [] }` for an unlinked user so
   * Settings can render its state without a second round-trip, matching
   * `redmine.status`. An empty `activities` on a connected account means the
   * instance has none configured and cannot receive time at all.
   */
  async 'redmine.activities.list'() {
    const { userId } = await requireIdentity(this);

    const account = await findRedmineAccount(userId);
    if (!account) return { connected: false, activities: [], selectedId: null, selectedReason: 'none' };
    enforceRedmineLimit(accountLimiter, userId);

    const activities = await activitiesOrMeteorError(userId, account);
    const link = await RedmineLinks.findOneAsync({ userId }, { fields: { defaultActivityId: 1 } });
    return activitySelection(activities, link?.defaultActivityId ?? null);
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
    enforceRedmineLimit(accountLimiter, userId);

    if (!Number.isInteger(activityId)) {
      throw new Meteor.Error('bad-request', 'An activity id is required.');
    }

    const account = await requireRedmineAccount(userId);
    const activities = await activitiesOrMeteorError(userId, account);

    if (!activities.some((a) => a.id === activityId)) {
      throw new Meteor.Error('bad-request', 'That activity does not exist on this Redmine instance.');
    }

    await RedmineLinks.updateAsync({ userId }, { $set: { defaultActivityId: activityId } });
    return activitySelection(activities, activityId);
  },

  /**
   * What a push would send, for the confirmation dialog.
   *
   * Pure read — it creates nothing in Redmine. Rows that cannot be sent are
   * still returned, carrying a `blockedReason`, so the dialog can explain the
   * omission rather than quietly showing a shorter list than the user's day.
   */
  async 'redmine.timeEntries.preview'() {
    const { userId } = await requireIdentity(this);

    const account = await findRedmineAccount(userId);
    if (!account) return { connected: false, idle: true, rows: [], baseUrl: optionalRedmineBaseUrl() };
    enforceRedmineLimit(accountLimiter, userId);

    const idle = await isIdleForPush(userId);
    const rows = await buildPreviewRows(userId, account);
    return { connected: true, idle, rows, baseUrl: account.baseUrl };
  },

  /**
   * Never send one ticket-day's unsent time to Redmine ("Never send" in the push
   * dialog). Writes nothing to Redmine: the seconds unsent right now are recorded
   * as handled, so the row leaves the dialog for good. Time tracked on that day
   * afterwards is offered as new. The seconds are re-derived here, never taken
   * from the client.
   */
  async 'redmine.timeEntries.discard'({ ticketId, date } = {}) {
    const { userId } = await requireIdentity(this);
    // Not metered with `enforceRedmineLimit`, unlike its neighbours: it never
    // calls Redmine (local timer data and one Mongo write), and the push lock
    // below already serializes it per user.
    if (
      typeof ticketId !== 'string' ||
      !/^\d+$/.test(ticketId) ||
      typeof date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date)
    ) {
      throw new Meteor.Error('bad-request', 'A ticket id and a YYYY-MM-DD date are required.');
    }
    await requireRedmineAccount(userId);

    // The push lock: a push running now could otherwise send the same seconds.
    return withPushLock(userId, async () => {
      const totals = (await redmineTicketDaysFor(userId)).filter(
        (total) => String(total.ticketId) === ticketId && total.date === date,
      );
      const [unsent] = unsentTotals(totals, await pushLedgerFor(userId));
      if (!unsent) return { discardedSeconds: 0 };
      await recordDiscard(userId, ticketId, date, unsent.seconds);
      return { discardedSeconds: unsent.seconds };
    });
  },

  /**
   * Create one Redmine time entry per confirmed ticket-day.
   *
   * **Irreversible: time entries are never edited or deleted.** The
   * client says *which* ticket-days to send and may override the activity; it
   * never supplies the hours. Those are recomputed here from the timer
   * sessions, because a client-supplied number would let a stale or tampered
   * dialog write a figure nobody worked.
   */
  async 'redmine.timeEntries.push'({ entries = [] } = {}) {
    const { userId } = await requireIdentity(this);
    enforceRedmineLimit(accountLimiter, userId);

    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Meteor.Error('bad-request', 'Nothing to send.');
    }

    const account = await requireRedmineAccount(userId);

    // The same gate the button enforces, re-checked server-side: a timer that
    // started after the dialog opened would otherwise have its partial total
    // written permanently.
    if (!(await isIdleForPush(userId))) {
      throw new Meteor.Error(
        'not-idle',
        'Clock out and stop every ticket timer before sending time to Redmine.',
      );
    }

    // Held across both the unsent-time calculation and the writes: releasing it
    // between them would let a second push read the same unsent figure before
    // this one records its entry.
    return withPushLock(userId, async (stillHeld) => {
      const results = await pushRequestedEntries(userId, account, entries, stillHeld);
      // Logged time is one of the relevant list's signals, so the cached list is
      // now out of date about the issues this push covered.
      bustUserCaches(userId);
      return { results };
    });
  },
});

/**
 * Push each requested ticket-day, holding the caller's push lock.
 *
 * Unsent time is recomputed here rather than taken from the client, then
 * matched against the requested rows.
 */
async function pushRequestedEntries(userId, account, entries, stillHeld) {
  const previewRows = await buildPreviewRows(userId, account);
  const byKey = new Map(previewRows.map((row) => [ticketDayKey(row.ticketId, row.date), row]));

  // The same enumeration the rows were resolved from, served from cache. If it
  // cannot be fetched the set stays empty, so every override is rejected as
  // unverifiable rather than trusted.
  let validActivityIds = new Set();
  try {
    validActivityIds = new Set((await getActivitiesForUser(userId, account)).map((a) => a.id));
  } catch {
    /* unreachable — handled per row below */
  }

  // A ticket-day listed twice would otherwise have its unsent time sent twice.
  const handled = new Set();

  const results = [];
  for (const requested of entries) {
    const key = ticketDayKey(requested?.ticketId, requested?.date);
    const row = handled.has(key) ? undefined : byKey.get(key);
    handled.add(key);

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
    // rejects the row instead of falling back to the default: the entry is
    // permanent, and writing an activity the user did not choose is worse than
    // writing nothing.
    let activityId = row.activityId;
    if (requested.activityId != null) {
      if (!Number.isInteger(requested.activityId) || !validActivityIds.has(requested.activityId)) {
        results.push({ ticketId: row.ticketId, date: row.date, ok: false, reason: 'invalid-activity' });
        continue;
      }
      activityId = requested.activityId;
    }

    // Renewed before every write, so the lock cannot go stale under a long
    // push. Losing it means another push took over: stop, rather than risk
    // both sending the same time.
    if (!(await stillHeld())) {
      results.push({ ticketId: row.ticketId, date: row.date, ok: false, reason: 'push-interrupted' });
      continue;
    }

    results.push(await pushOneEntry(userId, account, row, activityId));
  }

  return results;
}
