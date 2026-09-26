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
import { Mongo } from 'meteor/mongo';

import { requireIdentity } from './auth-bridge';
import { findRedmineAccount, requireRedmineAccount } from './redmine-account';
import { createUserTtlCache } from './redmine-cache';
import { createRateLimiter } from './rate-limit';
import {
  getCurrentUser,
  getIssue,
  listIssuesAssignedTo,
  listIssuesByIds,
  listProjectMemberships,
  listProjects,
  optionalRedmineBaseUrl,
  searchIssues,
} from './redmine-client';
import { toAssignableUsers, toIssue } from './redmine-issues';
import {
  DISMISSED,
  PINNED,
  dismissedIssueIds,
  ensureRedmineIssuePrefIndexes,
  readIssuePrefs,
  setIssuePref,
} from './redmine-prefs';
import { buildRelevantIssues } from './redmine-relevance';
import { MAX_SEARCH_RESULTS, matchAssignees, parseRedmineQuery } from './redmine-query';
import { RedmineLinks, Timers, WorkItems, isValidId } from './collections';
import { toRedmineMeteorError } from './redmine';
import { REDMINE, isRedmineIssueId } from './ticket-refs';

/**
 * The merged list, per user, for 90 seconds. Short enough that a pin or a
 * dismissal would be visible even without the explicit bust in `setIssuePref`,
 * long enough that opening and closing the dropdown a few times costs Redmine
 * five queries rather than twenty-five.
 */
const relevantCache = createUserTtlCache(90 * 1000);

/** The caller's own Redmine user id, for the activity feed. See below. */
const redmineUserIdCache = createUserTtlCache(60 * 60 * 1000);

/**
 * Everyone the caller shares a project with, for the `@name` search. Held for
 * five minutes, like the other membership reads: project rosters change on the
 * scale of weeks, and this is the one lookup here that costs a request per
 * project.
 */
const projectMembersCache = createUserTtlCache(5 * 60 * 1000);

/**
 * How many of the caller's projects the `@name` lookup will walk, and how many at
 * a time. Redmine has no "users I can see" endpoint — `/users.json` is admin-only
 * — so the roster has to be assembled from memberships, one request per project.
 * Both numbers are there to keep a user who belongs to a hundred projects from
 * turning one keystroke into a hundred simultaneous requests.
 */
const MAX_PROJECTS_FOR_MEMBERS = 25;
const MEMBERSHIP_CONCURRENCY = 5;

/**
 * What one user may ask of Redmine through these methods.
 *
 * Search is generous because it is keystroke-driven and already waits for a pause
 * in typing; the relevant list is tight because its own 90-second cache absorbs
 * ordinary use, so anything past this rate is a client looping, not a person
 * working. Applied in the method rather than through `DDPRateLimiter` — see
 * rate-limit.js for why that would guard a door this app does not use.
 */
const searchLimiter = createRateLimiter({ limit: 20, windowMs: 10 * 1000 });
const relevantLimiter = createRateLimiter({ limit: 10, windowMs: 60 * 1000 });

/** Count this call against `limiter`, or refuse it with `too-many-requests`. */
function enforceLimit(limiter, userId) {
  const { allowed, retryAfterMs } = limiter.check(userId);
  if (!allowed) {
    throw new Meteor.Error(
      'too-many-requests',
      'Too many Redmine requests. Try again in a moment.',
      { timeToReset: retryAfterMs },
    );
  }
}

Meteor.startup(async () => {
  try {
    await ensureRedmineIssuePrefIndexes();
  } catch (error) {
    console.error('[redmine] failed to create issue-preference indexes:', error);
  }
});

/** Map `items` through `fn`, at most `size` at a time, keeping the results in order. */
async function mapInChunks(items, size, fn) {
  const results = [];
  for (let start = 0; start < items.length; start += size) {
    results.push(...(await Promise.all(items.slice(start, start + size).map(fn))));
  }
  return results;
}

/**
 * The users the caller shares a project with — the only roster a non-admin key
 * can see, and what an `@name` query is matched against.
 *
 * A project whose memberships cannot be read is skipped rather than failing the
 * search: a roster missing one project still answers most `@name` queries, and a
 * name that turns out to be missing is reported as "no match", which is the same
 * thing the user would be told if that colleague had left.
 */
function projectMembersFor(userId, account) {
  return projectMembersCache.get(userId, 'members', async () => {
    const projects = (await listProjects(account)).slice(0, MAX_PROJECTS_FOR_MEMBERS);
    const memberships = await mapInChunks(projects, MEMBERSHIP_CONCURRENCY, (project) =>
      listProjectMemberships(account, project.id).catch(() => []),
    );
    return toAssignableUsers(memberships.flat());
  });
}

/**
 * Run exactly one bounded Redmine query for a parsed search, and shape the result.
 *
 * `value === null` means the query was not worth asking — too short, or a link to
 * an instance that is not the caller's — so nothing is sent and the empty list is
 * returned with the `kind` that was read, for the UI to explain.
 *
 * An issue number for an issue the caller cannot see answers the empty list, the
 * same as a number that does not exist. Telling those two apart would confirm the
 * existence of an issue to someone Redmine has decided must not see it.
 */
async function runSearch(userId, account, kind, value) {
  if (value === null) return [];

  if (kind === 'id' || kind === 'url') {
    const issue = await getIssue(account, value);
    return issue ? [toIssue(issue)] : [];
  }

  if (kind === 'assignee') {
    const matches = matchAssignees(await projectMembersFor(userId, account), value);
    // Nought or several: the caller is asked to type more of the name rather than
    // shown one colleague's work under another's name.
    if (matches.length !== 1) return [];
    const raw = await listIssuesAssignedTo(account, matches[0].id, { limit: MAX_SEARCH_RESULTS });
    return raw.map(toIssue);
  }

  const ids = await searchIssues(account, value, { limit: MAX_SEARCH_RESULTS });
  if (!ids.length) return [];

  // Redmine's own search order is the useful one, and `/issues.json` does not keep
  // it, so the slim issues are put back into the order the ids arrived in.
  const raw = await listIssuesByIds(account, ids.slice(0, MAX_SEARCH_RESULTS));
  const byId = new Map(raw.map((issue) => [issue.id, toIssue(issue)]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

/**
 * The Redmine issue the caller is timing right now, if any — the only signal that
 * costs no Redmine call, and the strongest one there is.
 *
 * At most one timer runs per user (`closeRunningSession` closes the rest), so this
 * is a list of nought or one.
 */
async function runningRedmineIssueIds(userId) {
  const running = await Timers.findOneAsync({ userId, endTime: null }, { fields: { workItemId: 1 } });
  if (!isValidId(running?.workItemId)) return [];

  const item = await WorkItems.findOneAsync(new Mongo.ObjectID(running.workItemId), {
    fields: { source: 1, ticketId: 1 },
  });
  // Compared literally rather than through `normalizeSource`: a Redmine WorkItem
  // always carries its source, and a read path should not throw over a stray row.
  if (item?.source !== REDMINE || !isRedmineIssueId(item.ticketId)) return [];
  return [Number(item.ticketId)];
}

/**
 * The caller's own Redmine user id, which `/activity.atom` needs (it has no `me`).
 *
 * Almost always free: `redmine.connect` already stored it on the link row. The
 * `/users/current.json` fallback is for rows written before it did, and is cached
 * for an hour because a Redmine user id never changes.
 */
async function redmineUserIdFor(userId, account) {
  const link = await RedmineLinks.findOneAsync({ userId }, { fields: { redmineUserId: 1 } });
  if (link?.redmineUserId != null) return link.redmineUserId;
  return redmineUserIdCache.get(userId, 'redmineUserId', async () => {
    const user = await getCurrentUser(account);
    return user?.id ?? null;
  });
}

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
   * The issues most likely to be what the caller is looking for (A1).
   *
   * Replaces MVP1's "every issue this key can see": one small filtered query per
   * signal, merged and scored here, capped at 100. `partial: true` means a signal
   * dropped out and the list is short rather than wrong.
   *
   * `includeDismissed` is for the Tickets page table, which is not the dropdown
   * and must not be reshaped by what the user hid from their suggestions.
   */
  async 'redmine.issues.relevant'({ includeDismissed = false } = {}) {
    const { userId } = await requireIdentity(this);
    enforceLimit(relevantLimiter, userId);

    const account = await findRedmineAccount(userId);
    if (!account) {
      return { connected: false, baseUrl: optionalRedmineBaseUrl(), issues: [], partial: false };
    }

    const withDismissed = includeDismissed === true;
    // Only successful builds are cached, so a Redmine outage is retried rather
    // than remembered for 90 seconds.
    return relevantCache.get(userId, `relevant:${withDismissed}`, async () => {
      const now = Date.now();
      const [{ pinnedIds }, redmineUserId, runningIds] = await Promise.all([
        readIssuePrefs(userId, { now }),
        redmineUserIdFor(userId, account),
        runningRedmineIssueIds(userId),
      ]);

      try {
        const built = await buildRelevantIssues(account, {
          pinnedIds,
          runningIds,
          redmineUserId,
          now,
          // Deferred, because rule 5 needs Redmine's answer about what is assigned
          // to the caller before it can say which dismissals still stand.
          hiddenIssueIds: withDismissed
            ? undefined
            : async (assignedIssueIds) =>
                (await readIssuePrefs(userId, { assignedIssueIds, now })).dismissedIds,
        });
        return { connected: true, baseUrl: account.baseUrl, ...built };
      } catch (err) {
        throw toRedmineMeteorError(err);
      }
    });
  },

  /**
   * Find issues the caller named (A2).
   *
   * One bounded Redmine call per search, chosen by what they typed — an issue
   * number, a pasted link, `@someone`, or words matched against issue **titles**
   * only. At most 25 results, and never a match drawn from a description or a
   * note.
   *
   * Dismissed issues are **not** filtered out: hiding a suggestion means "stop
   * offering me this", not "hide it from me when I go looking for it".
   *
   * The query itself is never logged. A user may type a patient's name here.
   */
  async 'redmine.issues.search'({ query } = {}) {
    const { userId } = await requireIdentity(this);
    enforceLimit(searchLimiter, userId);
    if (typeof query !== 'string') {
      throw new Meteor.Error('bad-request', 'A search query is required.');
    }

    const account = await findRedmineAccount(userId);
    if (!account) {
      return { connected: false, baseUrl: optionalRedmineBaseUrl(), kind: 'text', issues: [] };
    }

    const { kind, value } = parseRedmineQuery(query, account.baseUrl);
    try {
      return {
        connected: true,
        baseUrl: account.baseUrl,
        kind,
        issues: await runSearch(userId, account, kind, value),
      };
    } catch (err) {
      throw toRedmineMeteorError(err);
    }
  },

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

    // The link is checked before the rows, so an unlinked caller is told
    // `connected: false` like every other method here rather than `true` with an
    // empty list — Settings reads that flag to decide what to render at all.
    const account = await findRedmineAccount(userId);
    if (!account) return { connected: false, baseUrl: optionalRedmineBaseUrl(), issues: [] };

    const issueIds = await dismissedIssueIds(userId);
    if (!issueIds.length) return { connected: true, baseUrl: account.baseUrl, issues: [] };

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
