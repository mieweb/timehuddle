/**
 * Scoring for the relevant-issues list.
 *
 * "Every issue the key can see" is a very large set on the enterprise instance,
 * and every subject may carry PHI, so Redmine is asked a handful of *filtered*
 * questions instead — what is assigned to me, what I logged time against, what
 * I touched, what I watch, what I pinned — and the answers are merged here.
 *
 * One issue usually answers several of those questions at once, so each signal
 * carries a weight, an issue's score is the sum of the signals that matched it,
 * and the reasons ride along in the order they contributed — the dropdown shows
 * only the strongest one, read off the front of the list.
 *
 * The module deliberately does not touch Meteor or Mongo. The three things it
 * needs from them — the caller's pins, whether a timer is running, and which
 * issues they have hidden — arrive as arguments, one of them as a callback,
 * because the hidden set can only be computed once Redmine has said what is
 * assigned to the user (dismissal rule 5).
 */
import {
  ASSIGNED_ISSUES_LIMIT,
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
const SIGNAL_TIMEOUT_MS = 6000;

/**
 * How long the whole list may take, signals and the batched resolve together.
 * The signals run in parallel but the resolve has to wait for them, so bounding
 * each step separately would let a slow signal and a slow resolve add up to
 * twelve seconds. Set under the 8-second budget the method is judged on, leaving
 * room for the Mongo reads either side.
 */
export const RELEVANT_BUDGET_MS = 7500;

/**
 * The least time worth giving the batched resolve. With less left, it is skipped
 * and the list is served from the issues the signals already returned, marked
 * `partial` — a request that is bound to time out only makes the wait longer.
 */
const MIN_RESOLVE_MS = 1000;

/** How far back "recently logged" and "recent activity" look. */
const RECENT_DAYS = 14;

/**
 * What each signal is worth. Not a ranking of importance in the abstract — it is
 * a ranking of *how sure the signal is that the user wants this issue now*. A
 * timer running on an issue is certainty; something assigned to them is a
 * standing obligation; time they logged is proof they worked on it; a watch is a
 * standing interest at best. An issue on My Board was put there by hand, which
 * says as much as a pin.
 */
export const SIGNAL_SCORES = {
  running: 100,
  assigned: 60,
  logged: 50,
  activity: 40,
  pinned: 30,
  board: 30,
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

/** How many issues the relevant list may return, beyond the Tickets table's own rows. */
const MAX_RELEVANT_ISSUES = 100;

/**
 * The reasons that put an issue in the Tickets table. Those rows are never cut
 * by `MAX_RELEVANT_ISSUES`: the table promises to show every issue that is
 * assigned to the user, pinned, or on My Board, and a cap that dropped one
 * would leave a My Board entry pointing at nothing.
 */
const TABLE_REASONS = ['assigned', 'pinned', 'board'];

/** Redmine's `limit` ceiling, and so the most ids one `listIssuesByIds` call may ask for. */
const IDS_PER_REQUEST = 100;

/**
 * The most pinned and My Board issues fetched in one build — the pin cap (500)
 * with room for a board as long again. A bound on requests, not a feature.
 */
const MAX_KEPT_ISSUES = 1000;

/**
 * A slim issue (as `toIssue` shapes one) plus why it is in the list.
 *
 * @typedef {object} RelevantIssue
 * @property {number} id
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

/** The issue ids an undated signal names. */
function idsOf(signal) {
  return (Array.isArray(signal) ? signal : []).map(Number);
}

/**
 * Score, merge and sort the signals into the relevant list.
 *
 * Only issues present in `issuesById` are returned: a signal that named an id
 * whose slim fields could not be resolved is dropped rather than rendered as a
 * bare number, and the caller decides how many ids are worth resolving.
 *
 * @param {object} signals  issue ids per signal; `logged` and `activity` are
 *   `{ issueId, lastAt }` as `latestByIssue` returns them
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

  for (const reason of ['running', 'assigned', 'watching', 'pinned', 'board']) {
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
 * The reasons an issue matched, strongest contribution first — the client reads
 * a row's single chip off the front.
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
 * Fetch issues by id, `IDS_PER_REQUEST` at a time, in parallel. One failed
 * request fails the lot: the caller reads "did not answer" as "unknown", and a
 * half-answer would pass off the missing half as issues that do not exist.
 */
async function listIssuesByIdsChunked(account, issueIds, options) {
  const chunks = [];
  for (let start = 0; start < issueIds.length; start += IDS_PER_REQUEST) {
    chunks.push(issueIds.slice(start, start + IDS_PER_REQUEST));
  }
  return (await Promise.all(chunks.map((ids) => listIssuesByIds(account, ids, options)))).flat();
}

/**
 * The pinned and My Board ids to fetch, board first, without repeats, bounded.
 * Board first because an entry left unresolved is a row the user put on their
 * board by hand, now missing from it.
 */
function keptIssueIds(pinnedIds = [], boardIds = []) {
  return [...new Set([...boardIds, ...pinnedIds].map(Number))].slice(0, MAX_KEPT_ISSUES);
}

/**
 * Ask Redmine every filtered question at once, and report which ones answered.
 *
 * `Promise.allSettled`, not `Promise.all`: a signal that fails or times out is
 * dropped and the list is served without it, because four fifths of the right
 * answer beats an error page. Each call carries its own 6-second bound, so one
 * slow query cannot spend the whole budget.
 *
 * `activity` is skipped when the caller's Redmine id is unknown, and `kept` (the
 * pinned and My Board issues, fetched together) when there are none — there is
 * nothing to ask in either case.
 */
async function gatherRemoteSignals(
  account,
  { from, redmineUserId = null, pinnedIds = [], boardIds = [] } = {},
) {
  const bound = { timeoutMs: SIGNAL_TIMEOUT_MS };
  const keptIds = keptIssueIds(pinnedIds, boardIds);
  const tasks = [
    ['assigned', () => listAssignedIssues(account, bound)],
    ['watching', () => listWatchedIssues(account, bound)],
    ['logged', () => listTimeEntryIssueIds(account, { from, ...bound })],
  ];
  if (redmineUserId != null) {
    tasks.push(['activity', () => listActivityIssueIds(account, { redmineUserId, from, ...bound })]);
  }
  if (keptIds.length) {
    tasks.push(['kept', () => listIssuesByIdsChunked(account, keptIds, bound)]);
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

/**
 * The issue ids in a raw Redmine issues array. Distinct from `idsOf` above, which
 * reads a *signal* — a signal may carry dates as well as ids.
 */
const issueIdsIn = (raw) => (raw ?? []).map((issue) => issue?.id).filter((id) => id != null);

/**
 * Build the relevant list: run the signals, drop what the user has hidden, resolve
 * the ids that arrived bare, score, and cap.
 *
 * The order matters in two places. Dismissals are removed **before** the cap, so
 * hiding a suggestion pulls the next one up instead of leaving the list a row
 * short. And the "assigned to me" answer is handed to `resolvePrefs`, so the
 * reassignment rules (rules 5 and 10) can be applied without a second Redmine
 * call.
 *
 * Throws the first signal's own error when *every* signal failed — mapping it to
 * something a client understands is the Meteor layer's job.
 *
 * @param {object} account
 * @param {object} [context]
 * @param {number[]} [context.pinnedIds]
 * @param {number[]} [context.boardIds]
 * @param {number[]} [context.runningIds]
 * @param {number|null} [context.redmineUserId]
 * @param {(assignedIssueIds: number[], assignedKnown: boolean) =>
 *   Promise<{hiddenIds?: number[], removedIds?: number[]}>} [context.resolvePrefs]
 *   given what Redmine says is assigned to the caller: the ids to leave out
 *   (`hiddenIds`), and the ids whose assignment no longer counts because the
 *   caller took them out of their Tickets table (`removedIds`)
 * @param {number} [context.now]  the date the decay and `from` are measured from
 * @param {() => number} [context.clock]  wall clock for the time budget; separate
 *   from `now` so a test can fix the date and still move time along
 * @returns {Promise<{issues: RelevantIssue[], partial: boolean, unavailableBoardIds: number[]}>}
 *   `unavailableBoardIds` — My Board ids Redmine was asked for and did not
 *   return: deleted, or no longer visible to the caller. Empty whenever that
 *   question went unanswered, so it never names an issue that merely failed to load.
 */
export async function buildRelevantIssues(
  account,
  {
    pinnedIds = [],
    boardIds = [],
    runningIds = [],
    redmineUserId = null,
    resolvePrefs,
    now = Date.now(),
    clock = Date.now,
  } = {},
) {
  const startedAt = clock();
  const from = isoDay(now - RECENT_DAYS * MS_PER_DAY);

  const { answered, failures, attempted } = await gatherRemoteSignals(account, {
    from,
    redmineUserId,
    pinnedIds,
    boardIds,
  });

  // Every question failing is a different situation from some of them failing:
  // there is no list to serve, so the caller is told why rather than shown "none".
  if (failures.length === attempted) throw failures[0].reason;

  const assignedIssueIds = issueIdsIn(answered.assigned);
  // "Not in the list" means "not assigned" only when the list is whole: a failed
  // signal, or one cut off at its limit, would forget removals that still stand.
  const assignedKnown =
    'assigned' in answered && assignedIssueIds.length < ASSIGNED_ISSUES_LIMIT;
  const prefs = resolvePrefs ? await resolvePrefs(assignedIssueIds, assignedKnown) : {};
  const hidden = new Set(prefs.hiddenIds ?? []);
  const removed = new Set(prefs.removedIds ?? []);

  // `assigned`, `watching` and `kept` answer with whole issues, so their slim
  // fields are already in hand; only `logged`, `activity` and the running timer
  // arrive as bare ids.
  const issuesById = new Map();
  for (const raw of [...(answered.assigned ?? []), ...(answered.watching ?? []), ...(answered.kept ?? [])]) {
    if (raw?.id != null && !hidden.has(raw.id)) issuesById.set(raw.id, toIssue(raw));
  }

  // Only a `kept` fetch that answered can say an issue is gone; one that failed
  // says nothing, and the board keeps its entries.
  const keptReturned = new Set(issueIdsIn(answered.kept));
  const keptAsked = new Set(keptIssueIds(pinnedIds, boardIds));
  const unavailableBoardIds =
    'kept' in answered ? boardIds.filter((id) => keptAsked.has(id) && !keptReturned.has(id)) : [];

  const logged = latestByIssue(answered.logged);
  const activity = latestByIssue(answered.activity);

  // Highest-scoring signal first, so if the 100-id budget runs out it is spent on
  // the ids most likely to reach the top of the list.
  const unresolved = new Set();
  for (const id of [...runningIds, ...logged.map((e) => e.issueId), ...activity.map((e) => e.issueId)]) {
    if (!issuesById.has(id) && !hidden.has(id)) unresolved.add(id);
  }

  let resolveFailed = false;
  const resolveMs = Math.min(SIGNAL_TIMEOUT_MS, RELEVANT_BUDGET_MS - (clock() - startedAt));
  if (unresolved.size && resolveMs < MIN_RESOLVE_MS) {
    // The signals spent the budget. Serve what they returned rather than wait.
    resolveFailed = true;
  } else if (unresolved.size) {
    try {
      const resolved = await listIssuesByIds(account, [...unresolved].slice(0, MAX_RELEVANT_ISSUES), {
        timeoutMs: resolveMs,
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
      // A removed issue is still assigned in Redmine; the assignment just no
      // longer counts (rule 8). Its other signals still apply.
      assigned: assignedIssueIds.filter((id) => !removed.has(id)),
      watching: issueIdsIn(answered.watching),
      pinned: pinnedIds,
      board: boardIds,
      logged,
      activity,
    },
    issuesById,
    now,
  );

  return {
    issues: capKeepingTableRows(issues),
    partial: failures.length > 0 || resolveFailed,
    unavailableBoardIds,
  };
}

/**
 * The first `MAX_RELEVANT_ISSUES` issues, plus every Tickets table row past
 * them, in the original order.
 */
function capKeepingTableRows(issues) {
  let others = 0;
  return issues.filter((issue) => {
    if (issue.reasons.some((reason) => TABLE_REASONS.includes(reason))) return true;
    others += 1;
    return others <= MAX_RELEVANT_ISSUES;
  });
}
