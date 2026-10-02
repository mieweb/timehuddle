/**
 * Pure rules behind the Redmine search suggestions.
 *
 * Kept free of React so the decisions that shape what a user sees — which
 * suggestions match what they typed, when to ask the server, what an empty
 * result means — are unit-tested on their own (`suggestions.test.ts`).
 */
import type {
  RedmineIssue,
  RedmineRelevanceReason,
  RedmineRelevantIssue,
  RedmineSearchKind,
} from '../../../lib/api';

import { suggestionText } from './suggestionStrings';

/** How many suggestions show before "Show all". */
export const SUGGESTION_LIMIT = 8;

/** Server search waits for this pause in typing. */
export const SEARCH_DEBOUNCE_MS = 300;

/** Plain text shorter than this is filtered locally only (the server refuses it too). */
const MIN_SERVER_QUERY = 3;

const ISSUE_NUMBER = /^#?(\d+)$/;
const ISSUE_URL_ID = /\/issues\/(\d+)\/?(?:[?#].*)?$/;

const isLink = (query: string) => /^https?:\/\//i.test(query);

/**
 * Whether the query goes to the server at all. Issue numbers and links always
 * do; words and `@name` only from `MIN_SERVER_QUERY` characters.
 */
export function shouldSearchServer(raw: string): boolean {
  const query = raw.trim();
  if (!query) return false;
  if (isLink(query) || ISSUE_NUMBER.test(query)) return true;
  return query.length >= MIN_SERVER_QUERY;
}

/**
 * Whether to skip the typing pause. A number or a pasted link is complete the
 * moment it lands, so there is nothing to wait for.
 */
export function isCompleteQuery(raw: string): boolean {
  const query = raw.trim();
  return isLink(query) || ISSUE_NUMBER.test(query);
}

/**
 * The suggestions that match what the user typed, in the server's order.
 *
 * - `#12` or `12` matches issue numbers starting with those digits
 * - a pasted issue link matches that issue, when it is on the connected
 *   instance (`baseUrl`): issue numbers mean nothing across instances, so a
 *   link elsewhere is left to the server search, which says so
 * - `@name` matches the assignee's name
 * - anything else matches the title, project or assignee, ignoring case
 */
export function filterSuggestions<T extends RedmineIssue>(
  issues: T[],
  raw: string,
  baseUrl: string | null,
): T[] {
  const query = raw.trim().toLowerCase();
  if (!query) return issues;

  const number = query.match(ISSUE_NUMBER)?.[1];
  if (number) return issues.filter((issue) => String(issue.id).startsWith(number));

  if (isLink(query)) {
    const base = baseUrl?.replace(/\/+$/, '').toLowerCase();
    if (!base || !query.startsWith(`${base}/issues/`)) return [];
    const id = query.match(ISSUE_URL_ID)?.[1];
    return id ? issues.filter((issue) => String(issue.id) === id) : [];
  }

  if (query.startsWith('@')) {
    const name = query.slice(1).trim();
    if (!name) return issues.filter((issue) => issue.assignedTo);
    return issues.filter((issue) => includesWord(issue.assignedTo?.name, name));
  }

  return issues.filter(
    (issue) =>
      issue.subject.toLowerCase().includes(query) ||
      includesWord(issue.project?.name, query) ||
      includesWord(issue.assignedTo?.name, query),
  );
}

function includesWord(value: string | undefined | null, query: string): boolean {
  return Boolean(value && value.toLowerCase().includes(query));
}

/**
 * Server results the user has not already got: anything in the Tickets table,
 * or already listed under "Suggested for you", is left out.
 */
export function newSearchResults(
  results: RedmineIssue[],
  alreadyShownIds: ReadonlySet<number>,
): RedmineIssue[] {
  return results.filter((issue) => !alreadyShownIds.has(issue.id));
}

/** What to tell the user when a search found nothing, worded by how it was read. */
export function emptySearchMessage(kind: RedmineSearchKind, raw: string): string {
  const query = raw.trim();
  switch (kind) {
    case 'id':
      return suggestionText.emptyById(query.replace(/^#/, ''));
    case 'url':
      return suggestionText.emptyByUrl;
    case 'assignee':
      return suggestionText.emptyByAssignee(query.replace(/^@/, '').trim());
    default:
      return suggestionText.emptyByText(query);
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The issue's reasons with `running` corrected to what is true right now.
 *
 * The server's list is cached for up to 90 seconds, so its `running` goes stale
 * the moment a timer starts or stops. The page already tracks the running timer
 * live, and that wins: `running` is dropped from an issue that is no longer
 * being timed, and put first on the one that is.
 */
export function liveReasons(
  issue: RedmineRelevantIssue,
  runningIssueId: number | null,
): RedmineRelevanceReason[] {
  // Optional-chained: one malformed issue must cost a chip, not the page.
  const others = (issue.reasons ?? []).filter((reason) => reason !== 'running');
  return issue.id === runningIssueId ? ['running', ...others] : others;
}

/**
 * The chip a suggestion shows: its strongest reason, live-corrected for the
 * running timer. "Logged" carries how long ago, in the user's locale.
 */
export function reasonLabel(
  issue: RedmineRelevantIssue,
  {
    now = Date.now(),
    locale,
    runningIssueId = null,
  }: { now?: number; locale?: string; runningIssueId?: number | null } = {},
): string | null {
  const reason = liveReasons(issue, runningIssueId)[0];
  if (!reason) return null;
  if (reason !== 'logged') return suggestionText.reason[reason];

  const at = issue.lastTimeLoggedAt ? Date.parse(issue.lastTimeLoggedAt) : NaN;
  if (Number.isNaN(at)) return suggestionText.loggedReasonUndated;

  // Whole calendar days, so "today" and "yesterday" read naturally.
  const days = Math.round((startOfDay(at) - startOfDay(now)) / DAY_MS);
  const when = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(days, 'day');
  return suggestionText.loggedReason(when);
}

function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
