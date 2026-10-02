/**
 * The Redmine suggestion surface — what TimeHuddle offers a user before and
 * while they type in the Tickets search bar.
 *
 * Every issue the user's key can see is an enormous response on the enterprise
 * instance, and every subject in it may carry PHI, so the questions asked here
 * are narrow by construction:
 *
 *   - `redmine.issues.relevant` — merge a handful of filtered signals into the
 *     list shown on focus,
 *   - `redmine.issues.search`   — one bounded query for what the user typed,
 *   - `redmine.prefs.set` / `redmine.prefs.listDismissed` — TimeHuddle's own pins
 *     and dismissals, which Redmine has no field for,
 *   - `redmine.issues.removeFromTable` — take issues out of the user's Tickets
 *     table and My Board (bulk Delete), leaving Redmine untouched.
 *
 * Every call runs under the caller's own personal API key, so Redmine's own
 * visibility rules decide what comes back and there is no admin key to leak.
 * Nothing Redmine returns is persisted: the only rows written are the ids in
 * `RedmineIssuePrefs`.
 */
import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';

import { requireIdentity } from './auth-bridge';
import { findRedmineAccount, redmineUserIdFor, requireRedmineAccount } from './redmine-account';
import { createUserTtlCache } from './redmine-cache';
import { createRateLimiter } from './rate-limit';
import {
  getIssue,
  isIssueAssignedToMe,
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
  removeIssuesFromTable,
  setIssuePref,
} from './redmine-prefs';
import { removeBoardEntries } from './my-board';
import { buildRelevantIssues } from './redmine-relevance';
import { MAX_SEARCH_RESULTS, matchAssignees, parseRedmineQuery } from './redmine-query';
import { MyBoard, Timers, WorkItems, isValidId } from './collections';
import { enforceRedmineLimit as enforceLimit, toRedmineMeteorError } from './redmine';
import { REDMINE, isRedmineIssueId } from './ticket-refs';

/**
 * The merged list, per user, for 90 seconds. Short enough that a pin or a
 * dismissal would be visible even without the explicit bust in `setIssuePref`,
 * long enough that opening and closing the dropdown a few times costs Redmine
 * five queries rather than twenty-five.
 */
const relevantCache = createUserTtlCache(90 * 1000);

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
 * in typing. The relevant list is tight, and counts only the calls its 90-second
 * cache cannot answer: a cache hit costs Redmine nothing, and the Tickets table
 * and the search dropdown both read the list, so counting hits would refuse a
 * person working normally. Ten real rebuilds a minute is a client looping.
 *
 * Applied in the method rather than through `DDPRateLimiter` — see rate-limit.js
 * for why that would guard a door this app does not use.
 */
const searchLimiter = createRateLimiter({ limit: 20, windowMs: 10 * 1000 });
const relevantLimiter = createRateLimiter({ limit: 10, windowMs: 60 * 1000 });

/**
 * The preference methods. Generous for a person — hiding half a dozen
 * suggestions in a row is normal — and still a bound, because `prefs.set` with
 * `state: 'dismissed'` asks Redmine whether the issue is assigned to the caller,
 * so an unmetered loop here is an unmetered loop against Redmine.
 */
const prefsLimiter = createRateLimiter({ limit: 30, windowMs: 60 * 1000 });

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
  return slimIssuesInOrder(ids, await listIssuesByIds(account, ids.slice(0, MAX_SEARCH_RESULTS)));
}

/** The slim issues for `raw`, in the order of `ids`; an id Redmine left out is dropped. */
function slimIssuesInOrder(ids, raw) {
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
 * The Redmine issues on the caller's My Board — a reason to be in their Tickets
 * table, whatever Redmine says about assignment (the board only shows rows the
 * table has, so without this an entry outlives its row).
 */
async function boardRedmineIssueIds(userId) {
  const entries = await MyBoard.find(
    { userId, sourceId: REDMINE },
    { fields: { ticketId: 1 } },
  ).fetchAsync();
  return entries.filter((e) => isRedmineIssueId(e.ticketId)).map((e) => Number(e.ticketId));
}

/** How many issues one bulk Delete may take out of the table (the client sends in chunks). */
export const MAX_REMOVE_PER_CALL = 100;

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
 *
 * `whenUnknown` is the answer when Redmine cannot say. A dismissal passes
 * **true**: that makes it permanent for its 15 days, which honours what the user
 * just did, where guessing "no" would risk the reassignment rule firing on the
 * next list build and putting the row straight back. The pin cap passes false,
 * because there only a confirmed yes counts.
 *
 * `account` may be a promise, so that failing to resolve it is "unknown" too.
 */
async function isAssignedToCaller(account, issueId, whenUnknown) {
  try {
    return await isIssueAssignedToMe(await account, issueId);
  } catch {
    return whenUnknown;
  }
}

Meteor.methods({
  /**
   * The issues most likely to be what the caller is looking for: one small
   * filtered query per signal, merged and scored, capped at 100. `partial: true`
   * means a signal dropped out and the list is short rather than wrong.
   *
   * `includeDismissed` is for the Tickets page table, which is not the dropdown
   * and must not be reshaped by what the user hid from their suggestions.
   */
  async 'redmine.issues.relevant'({ includeDismissed = false } = {}) {
    const { userId } = await requireIdentity(this);

    const account = await findRedmineAccount(userId);
    if (!account) {
      return { connected: false, baseUrl: optionalRedmineBaseUrl(), issues: [], partial: false };
    }

    const withDismissed = includeDismissed === true;
    // Only successful builds are cached, so a Redmine outage is retried rather
    // than remembered for 90 seconds. The limit is checked inside, so it counts
    // only the builds that go to Redmine.
    return relevantCache.get(userId, `relevant:${withDismissed}`, async () => {
      enforceLimit(relevantLimiter, userId);
      const now = Date.now();
      const [{ pinnedIds }, redmineUserId, runningIds, boardIds] = await Promise.all([
        readIssuePrefs(userId, { now }),
        redmineUserIdFor(userId, account),
        runningRedmineIssueIds(userId),
        boardRedmineIssueIds(userId),
      ]);

      try {
        const built = await buildRelevantIssues(account, {
          pinnedIds,
          boardIds,
          runningIds,
          redmineUserId,
          now,
          // Deferred, because rules 5 and 10 need Redmine's answer about what is
          // assigned to the caller before they can say which dismissals and
          // removals still stand.
          resolvePrefs: async (assignedIssueIds, assignedKnown) => {
            const prefs = await readIssuePrefs(userId, { assignedIssueIds, assignedKnown, now });
            return {
              hiddenIds: withDismissed ? [] : prefs.dismissedIds,
              removedIds: prefs.removedIds,
            };
          },
        });
        return { connected: true, baseUrl: account.baseUrl, ...built };
      } catch (err) {
        throw toRedmineMeteorError(err);
      }
    });
  },

  /**
   * Find issues the caller named.
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
   * Pin, dismiss or clear one Redmine issue for the caller.
   *
   * `state: null` clears it — Undo in the dropdown and Restore in Settings are
   * the same call. A dismissal affects only this user's suggestions: nothing here
   * touches Redmine, other users, search results, the Tickets table or timers.
   */
  async 'redmine.prefs.set'({ issueId, state } = {}) {
    const { userId } = await requireIdentity(this);
    enforceLimit(prefsLimiter, userId);
    const id = requireIssueId(issueId);
    if (state !== PINNED && state !== DISMISSED && state !== null) {
      throw new Meteor.Error('bad-request', 'state must be "pinned", "dismissed" or null.');
    }

    // Only a dismissal needs to know how the issue stood at the time.
    const assignedToMe =
      state === DISMISSED
        ? await isAssignedToCaller(await requireRedmineAccount(userId), id, true)
        : true;

    try {
      await setIssuePref(userId, id, state, { assignedToMe });
    } catch (err) {
      if (err?.name === 'TooManyPinsError') {
        // A pin only exists to put the issue in the Tickets table. One assigned
        // to the caller (their groups included) is there already, so at the cap
        // it needs no pin, and the timer path goes on to add it to My Board.
        if (await isAssignedToCaller(requireRedmineAccount(userId), id, false)) return { ok: true };
        throw new Meteor.Error('too-many-pins', err.message);
      }
      throw err;
    }
    return { ok: true };
  },

  /**
   * Take issues out of the caller's Tickets table and off their My Board — the
   * bulk Delete on the Tickets page. Nothing is sent to Redmine: the issues, and
   * everyone else's view of them, are untouched.
   *
   * An issue assigned to the caller stays out while it stays assigned to them;
   * starting a timer on it brings it back (see redmine-prefs-core.js, rules 8–11).
   */
  async 'redmine.issues.removeFromTable'({ issueIds } = {}) {
    const { userId } = await requireIdentity(this);
    enforceLimit(prefsLimiter, userId);
    if (!Array.isArray(issueIds) || issueIds.length === 0 || issueIds.length > MAX_REMOVE_PER_CALL) {
      throw new Meteor.Error('bad-request', `Between 1 and ${MAX_REMOVE_PER_CALL} issue ids are required.`);
    }
    const ids = [...new Set(issueIds.map(requireIssueId))];

    // Two writes, not one transaction; both are idempotent, so a retry after a
    // failure between them finishes the job rather than doubling it.
    await removeIssuesFromTable(userId, ids);
    await removeBoardEntries(
      userId,
      ids.map((id) => ({ sourceId: REDMINE, ticketId: String(id) })),
    );
    return { removedCount: ids.length };
  },

  /**
   * The issues the caller has hidden, for the Restore list in Settings.
   *
   * Titles are resolved here, from Redmine, at read time — `RedmineIssuePrefs`
   * stores ids only. An issue whose title cannot be fetched is dropped rather
   * than shown as a bare number: the list exists to be recognised, and a Restore
   * button next to "#4821" tells the user nothing.
   */
  async 'redmine.prefs.listDismissed'() {
    const { userId } = await requireIdentity(this);
    enforceLimit(prefsLimiter, userId);

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
    return { connected: true, baseUrl: account.baseUrl, issues: slimIssuesInOrder(issueIds, raw) };
  },
});
