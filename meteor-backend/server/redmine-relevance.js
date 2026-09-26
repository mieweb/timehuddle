/**
 * Scoring for the relevant-issues list (MVP2 A1).
 *
 * MVP1 answered "which Redmine issues should I see?" with "all of them". On the
 * enterprise instance that is a very large set and every subject may carry PHI,
 * so MVP2 asks Redmine a handful of *filtered* questions instead — what is
 * assigned to me, what I logged time against, what I touched, what I watch, what
 * I pinned — and merges the answers here.
 *
 * Merging is the whole job: one issue usually answers several of those questions
 * at once, and the order the user sees has to come from the combination rather
 * than from whichever query happened to return first. So each signal carries a
 * weight, an issue's score is the sum of the signals that matched it, and the
 * reasons ride along in the order they contributed — the dropdown shows only the
 * strongest one, and reading it off the front of the list keeps that choice on
 * this side of the wire.
 *
 * The module owns the whole list bar the plumbing: it asks Redmine the filtered
 * questions (`gatherRemoteSignals`), merges and scores the answers
 * (`scoreRelevantIssues`), and assembles the response (`buildRelevantIssues`).
 * What it deliberately does *not* do is touch Meteor or Mongo. The three things
 * it needs from them — the caller's pins, whether a timer is running, and which
 * issues they have hidden — arrive as arguments, one of them as a callback,
 * because the hidden set can only be computed once Redmine has said what is
 * assigned to the user (dismissal rule 5).
 *
 * That is what makes the list testable: `tests/redmine-relevance.test.ts` checks
 * the ordering with no I/O at all, and the signal handling with nothing but a
 * stubbed `fetch` — including the case that matters most, a signal timing out
 * while the rest of the list still arrives.
 */
import {
  listActivityIssueIds,
  listAssignedIssues,
  listIssuesByIds,
  listTimeEntryIssueIds,
  listWatchedIssues,
} from './redmine-client';
import { toIssue } from './redmine-issues';

/**
 * How long one signal may take. Well under the 8-second budget the whole method
 * is judged on, because the signals run in parallel and the point is that a slow
 * one is *dropped* rather than allowed to hold up the list.
 */
export const SIGNAL_TIMEOUT_MS = 6000;

/** How far back "recently logged" and "recent activity" look. */
export const RECENT_DAYS = 14;

/**
 * What each signal is worth. Not a ranking of importance in the abstract — it is
 * a ranking of *how sure the signal is that the user wants this issue now*. A
 * timer running on an issue is certainty; something assigned to them is a
 * standing obligation; time they logged is proof they worked on it; a watch is a
 * standing interest at best.
 */
export const SIGNAL_SCORES = {
  running: 100,
  assigned: 60,
  logged: 50,
  activity: 40,
  pinned: 30,
  watching: 20,
};

/**
 * Signals in the order a tie between equal contributions is broken, so the
 * reason a row shows is deterministic. Follows the weights above, and only
 * matters for signals that decay into a tie.
 */
const SIGNAL_ORDER = Object.keys(SIGNAL_SCORES);

/** How much a day of age takes off a dated signal (`logged`, `activity`). */
const DECAY_PER_DAY = 2;

/**
 * What a closed issue loses. Enough to sink it below every live signal except a
 * running timer, without hiding it outright: an issue closed an hour ago that
 * the user logged time against this morning is still the thing they are looking
 * for, and a list that silently omitted it would look broken.
 */
const CLOSED_PENALTY = -50;

/** How many issues the relevant list may return. */
export const MAX_RELEVANT_ISSUES = 100;

/**
 * A `SlimIssue` (as `toIssue` shapes one) plus why it is in the list — the
 * `RelevantIssue` of the Part A/Part B API contract, written down where the code
 * that produces it lives.
 *
 * @typedef {object} RelevantIssue
 * @property {number} id
 * @property {string} subject
 * @property {{id: number, name: string}|null} project
 * @property {{id: number, name: string, isClosed: boolean}|null} status
 * @property {{id: number, name: string}|null} assignedTo
 * @property {{id: number, name: string}|null} priority
 * @property {{id: number, name: string}|null} tracker
 * @property {string|null} createdAt
 * @property {string|null} updatedAt
 * @property {string[]} reasons  the signals that matched, strongest contribution first
 * @property {number} score
 * @property {string} [lastTimeLoggedAt]  present only when the `logged` signal matched
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole days between `at` and `now`, never negative. An undated or unparseable
 * signal is treated as fully decayed rather than as fresh — guessing "today"
 * would promote exactly the entries we know least about.
 */
function daysSince(at, now) {
  if (!at) return Infinity;
  const then = new Date(at).getTime();
  if (Number.isNaN(then)) return Infinity;
  return Math.max(0, Math.floor((now - then) / MS_PER_DAY));
}

/** A dated signal's weight after decay, never below zero. */
function decayed(base, at, now) {
  const days = daysSince(at, now);
  if (days === Infinity) return 0;
  return Math.max(0, base - DECAY_PER_DAY * days);
}

/**
 * The most recent occurrence per issue, as `{ issueId, lastAt }`.
 *
 * Redmine answers `/time_entries.json` and `/activity.atom` with one row per
 * event, so an issue worked on every day this week arrives several times. Only
 * the latest matters: the signal says "how recently", not "how often" — counting
 * occurrences would let one busy afternoon outrank a current assignment.
 *
 * @param {{issueId: number, at: string|null}[]} refs
 */
export function latestByIssue(refs) {
  const latest = new Map();
  for (const ref of Array.isArray(refs) ? refs : []) {
    const issueId = Number(ref?.issueId);
    if (!Number.isSafeInteger(issueId) || issueId <= 0) continue;
    const at = ref?.at ?? null;
    const held = latest.get(issueId);
    if (held === undefined || isLater(at, held)) latest.set(issueId, at);
  }
  return [...latest.entries()].map(([issueId, lastAt]) => ({ issueId, lastAt }));
}

/** Whether `at` is strictly later than `held`. A dated value beats an undated one. */
function isLater(at, held) {
  if (at == null) return false;
  if (held == null) return true;
  return new Date(at).getTime() > new Date(held).getTime();
}

/** The issue ids a signal names, whether it carries dates or not. */
function idsOf(signal) {
  return (Array.isArray(signal) ? signal : []).map((entry) =>
    typeof entry === 'object' && entry !== null ? Number(entry.issueId) : Number(entry),
  );
}

/**
 * Score, merge and sort the signals into the relevant list.
 *
 * Only issues present in `issuesById` are returned: a signal that named an id
 * whose slim fields could not be resolved is dropped rather than rendered as a
 * bare number, and the caller decides how many ids are worth resolving.
 *
 * @param {object} signals
 * @param {(number|{issueId: number})[]} [signals.running]  ids with a live timer
 * @param {(number|{issueId: number})[]} [signals.assigned] ids assigned to the user
 * @param {{issueId: number, lastAt: string|null}[]} [signals.logged]   from `latestByIssue`
 * @param {{issueId: number, lastAt: string|null}[]} [signals.activity] from `latestByIssue`
 * @param {(number|{issueId: number})[]} [signals.watching] ids the user watches
 * @param {(number|{issueId: number})[]} [signals.pinned]   ids the user pinned
 * @param {Map<number, object>} issuesById  slim issue DTOs, keyed by id
 * @param {number} [now]  epoch ms the decay is measured from
 * @returns {RelevantIssue[]} best first
 */
export function scoreRelevantIssues(signals, issuesById, now = Date.now()) {
  /** @type {Map<number, {contributions: Map<string, number>, lastTimeLoggedAt: string|null}>} */
  const merged = new Map();

  const contribute = (issueId, reason, score) => {
    if (!issuesById.has(issueId)) return;
    let held = merged.get(issueId);
    if (!held) {
      held = { contributions: new Map(), lastTimeLoggedAt: null };
      merged.set(issueId, held);
    }
    // A signal listing the same issue twice must not pay twice.
    held.contributions.set(reason, Math.max(held.contributions.get(reason) ?? 0, score));
    return held;
  };

  for (const reason of ['running', 'assigned', 'watching', 'pinned']) {
    for (const issueId of idsOf(signals?.[reason])) {
      contribute(issueId, reason, SIGNAL_SCORES[reason]);
    }
  }

  for (const entry of signals?.logged ?? []) {
    const held = contribute(
      Number(entry?.issueId),
      'logged',
      decayed(SIGNAL_SCORES.logged, entry?.lastAt, now),
    );
    if (held && isLater(entry?.lastAt ?? null, held.lastTimeLoggedAt)) {
      held.lastTimeLoggedAt = entry?.lastAt ?? null;
    }
  }

  for (const entry of signals?.activity ?? []) {
    contribute(Number(entry?.issueId), 'activity', decayed(SIGNAL_SCORES.activity, entry?.lastAt, now));
  }

  const scored = [...merged.entries()].map(([issueId, held]) => {
    const issue = issuesById.get(issueId);
    const running = held.contributions.has('running');
    const penalty = issue?.status?.isClosed && !running ? CLOSED_PENALTY : 0;
    const score = [...held.contributions.values()].reduce((sum, value) => sum + value, 0) + penalty;

    return {
      ...issue,
      reasons: orderedReasons(held.contributions),
      score,
      ...(held.lastTimeLoggedAt ? { lastTimeLoggedAt: held.lastTimeLoggedAt } : {}),
    };
  });

  return scored.sort(byScoreThenRecency);
}

/**
 * The reasons an issue matched, strongest contribution first — the order Part B
 * reads a row's single chip off the front of.
 */
function orderedReasons(contributions) {
  return [...contributions.entries()]
    .sort(
      (a, b) => b[1] - a[1] || SIGNAL_ORDER.indexOf(a[0]) - SIGNAL_ORDER.indexOf(b[0]),
    )
    .map(([reason]) => reason);
}

/** Highest score first, then the issue Redmine touched most recently. */
function byScoreThenRecency(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  const at = (issue) => (issue.updatedAt ? new Date(issue.updatedAt).getTime() : 0);
  return at(b) - at(a) || a.id - b.id;
}

// ─── Gathering the signals ───────────────────────────────────────────────────

/** `YYYY-MM-DD`, the form Redmine's `from` parameters take. */
function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Ask Redmine every filtered question at once, and report which ones answered.
 *
 * `Promise.allSettled`, not `Promise.all`: a signal that fails or times out is
 * dropped and the list is served without it, because four fifths of the right
 * answer beats an error page. Each call carries its own 6-second bound, so one
 * slow query cannot spend the whole budget.
 *
 * `activity` is skipped when the caller's Redmine id is unknown, and `pinned`
 * when they have no pins — there is nothing to ask in either case.
 */
export async function gatherRemoteSignals(account, { from, redmineUserId, pinnedIds }) {
  const bound = { timeoutMs: SIGNAL_TIMEOUT_MS };
  const tasks = [
    ['assigned', () => listAssignedIssues(account, bound)],
    ['watching', () => listWatchedIssues(account, bound)],
    ['logged', () => listTimeEntryIssueIds(account, { from, ...bound })],
  ];
  if (redmineUserId != null) {
    tasks.push(['activity', () => listActivityIssueIds(account, { redmineUserId, from, ...bound })]);
  }
  if (pinnedIds.length) {
    tasks.push(['pinned', () => listIssuesByIds(account, pinnedIds.slice(0, MAX_RELEVANT_ISSUES), bound)]);
  }

  const settled = await Promise.allSettled(tasks.map(([, run]) => run()));
  const answered = {};
  const failures = [];
  settled.forEach((outcome, index) => {
    const [name] = tasks[index];
    if (outcome.status === 'fulfilled') answered[name] = outcome.value;
    else failures.push({ name, reason: outcome.reason });
  });
  return { answered, failures, attempted: tasks.length };
}

/** The issue ids in a raw Redmine issues array. */
const idsIn = (raw) => (raw ?? []).map((issue) => issue?.id).filter((id) => id != null);

/**
 * Build the relevant list: run the signals, drop what the user has hidden, resolve
 * the ids that arrived bare, score, and cap.
 *
 * The order matters in two places. Dismissals are removed **before** the cap, so
 * hiding a suggestion pulls the next one up instead of leaving the list a row
 * short. And the "assigned to me" answer is handed to `hiddenIssueIds`, so the
 * reassignment rule (A3, rule 5) can be applied without a second Redmine call.
 *
 * Throws the first signal's own error when *every* signal failed — mapping it to
 * something a client understands is the Meteor layer's job.
 *
 * @param {{apiKey: string, baseUrl: string}} account
 * @param {object} [context]
 * @param {number[]} [context.pinnedIds]   the caller's pins
 * @param {number[]} [context.runningIds]  the issue a timer is running on, if any
 * @param {number|null} [context.redmineUserId]  for the activity feed
 * @param {(assignedIssueIds: number[]) => Promise<number[]>} [context.hiddenIssueIds]
 *   the ids to leave out, given what Redmine says is assigned to the caller
 * @param {number} [context.now]
 * @returns {Promise<{issues: RelevantIssue[], partial: boolean}>}
 */
export async function buildRelevantIssues(
  account,
  { pinnedIds = [], runningIds = [], redmineUserId = null, hiddenIssueIds, now = Date.now() } = {},
) {
  const from = isoDay(now - RECENT_DAYS * 24 * 60 * 60 * 1000);

  const { answered, failures, attempted } = await gatherRemoteSignals(account, {
    from,
    redmineUserId,
    pinnedIds,
  });

  // Every question failing is a different situation from some of them failing:
  // there is no list to serve, so the caller is told why rather than shown "none".
  if (failures.length === attempted) throw failures[0].reason;

  const assignedIssueIds = idsIn(answered.assigned);
  const hidden = new Set(hiddenIssueIds ? await hiddenIssueIds(assignedIssueIds) : []);

  // `assigned`, `watching` and `pinned` answer with whole issues, so their slim
  // fields are already in hand; only `logged`, `activity` and the running timer
  // arrive as bare ids.
  const issuesById = new Map();
  for (const raw of [...(answered.assigned ?? []), ...(answered.watching ?? []), ...(answered.pinned ?? [])]) {
    if (raw?.id != null && !hidden.has(raw.id)) issuesById.set(raw.id, toIssue(raw));
  }

  const logged = latestByIssue(answered.logged);
  const activity = latestByIssue(answered.activity);

  // Highest-scoring signal first, so if the 100-id budget runs out it is spent on
  // the ids most likely to reach the top of the list.
  const unresolved = new Set();
  for (const id of [...runningIds, ...logged.map((e) => e.issueId), ...activity.map((e) => e.issueId)]) {
    if (!issuesById.has(id) && !hidden.has(id)) unresolved.add(id);
  }

  let resolveFailed = false;
  if (unresolved.size) {
    try {
      const resolved = await listIssuesByIds(account, [...unresolved].slice(0, MAX_RELEVANT_ISSUES), {
        timeoutMs: SIGNAL_TIMEOUT_MS,
      });
      for (const raw of resolved) {
        // `hidden` is re-checked, not assumed: "it is gone from my suggestions" is
        // a promise to the user, and it should not rest on Redmine having answered
        // with exactly the ids it was asked for.
        if (raw?.id != null && !hidden.has(raw.id)) issuesById.set(raw.id, toIssue(raw));
      }
    } catch {
      // The signals still standing have their issues in hand; say the list is
      // incomplete rather than throw away what did arrive.
      resolveFailed = true;
    }
  }

  const issues = scoreRelevantIssues(
    {
      running: runningIds,
      assigned: assignedIssueIds,
      watching: idsIn(answered.watching),
      pinned: pinnedIds,
      logged,
      activity,
    },
    issuesById,
    now,
  );

  return { issues: issues.slice(0, MAX_RELEVANT_ISSUES), partial: failures.length > 0 || resolveFailed };
}
