/**
 * Data behind the Redmine search suggestions.
 *
 * Two lists, fetched differently on purpose:
 *
 * - **Suggested for you** — `redmine.issues.relevant()` *without*
 *   `includeDismissed`, loaded on first focus and cached per user for the
 *   session. The Tickets table makes its own call with `includeDismissed: true`,
 *   because hiding a suggestion must not remove a table row.
 * - **More from Redmine** — `redmine.issues.search`, after a pause in typing.
 *   Every search is numbered and only the latest answer is kept, so a slow
 *   response can never overwrite a newer one.
 *
 * Search text and results live in memory only: never storage, the URL or
 * analytics. A search term may be a patient's name.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ApiError,
  redmineApi,
  type RedmineIssue,
  type RedmineRelevantIssue,
  type RedmineSearchKind,
} from '../../../lib/api';

import { SEARCH_DEBOUNCE_MS, isCompleteQuery, shouldSearchServer } from './suggestions';

export type SuggestionsStatus = 'idle' | 'loading' | 'ready' | 'error' | 'not-connected';

interface SuggestionsState {
  status: SuggestionsStatus;
  issues: RedmineRelevantIssue[];
  partial: boolean;
}

export type SearchState =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'ready'; query: string; kind: RedmineSearchKind; issues: RedmineIssue[] }
  | { status: 'error'; query: string };

/**
 * The suggestion list per user, for the life of the page. Keyed by user id so a
 * second person signing in on the same tab is never shown the first one's list.
 */
const suggestionsCache = new Map<string, SuggestionsState>();

/** Drop the cached suggestions, so the next focus asks the server again. */
export function invalidateSuggestionsCache(): void {
  suggestionsCache.clear();
}

const IDLE: SuggestionsState = { status: 'idle', issues: [], partial: false };

/** Throttling is not the user's problem: say nothing, and let the next keystroke retry. */
const isThrottled = (err: unknown) => err instanceof ApiError && err.code === 'too-many-requests';

export function useRedmineSuggestions(userId: string | null, query: string) {
  const [suggestions, setSuggestions] = useState<SuggestionsState>(
    () => (userId && suggestionsCache.get(userId)) || IDLE,
  );
  const [search, setSearch] = useState<SearchState>({ status: 'idle' });
  const searchSeq = useRef(0);
  // Read by `dismiss` to remember where a row stood, outside any state updater
  // (StrictMode runs updaters twice, and the second run would find it gone).
  const suggestionsRef = useRef(suggestions);
  suggestionsRef.current = suggestions;

  // Mirror every change into the cache, so a remount keeps local dismissals.
  const commitSuggestions = useCallback(
    (next: SuggestionsState | ((prev: SuggestionsState) => SuggestionsState)) => {
      setSuggestions((prev) => {
        const value = typeof next === 'function' ? next(prev) : next;
        if (userId && (value.status === 'ready' || value.status === 'not-connected')) {
          suggestionsCache.set(userId, value);
        }
        return value;
      });
    },
    [userId],
  );

  const loadSuggestions = useCallback(
    async ({ force = false } = {}) => {
      if (!userId) return;
      const cached = suggestionsCache.get(userId);
      if (cached && !force) {
        setSuggestions(cached);
        return;
      }
      // A forced refresh keeps the rows on screen while it runs. A cache miss
      // starts empty: the cache was dropped because the Redmine link changed
      // (Settings), and the old list's titles must not linger.
      setSuggestions((prev) =>
        force ? { ...prev, status: 'loading' } : { ...IDLE, status: 'loading' },
      );
      try {
        const result = await redmineApi.issues.relevant();
        commitSuggestions(
          result.connected
            ? { status: 'ready', issues: result.issues, partial: result.partial }
            : { status: 'not-connected', issues: [], partial: false },
        );
      } catch (err) {
        setSuggestions((prev) => ({ ...prev, status: isThrottled(err) ? 'idle' : 'error' }));
      }
    },
    [userId, commitSuggestions],
  );

  const runSearch = useCallback(async (text: string) => {
    const seq = ++searchSeq.current;
    setSearch({ status: 'loading', query: text });
    try {
      const result = await redmineApi.issues.search(text);
      if (seq !== searchSeq.current) return;
      setSearch(
        result.connected
          ? { status: 'ready', query: text, kind: result.kind, issues: result.issues }
          : { status: 'idle' },
      );
    } catch (err) {
      if (seq !== searchSeq.current) return;
      setSearch(isThrottled(err) ? { status: 'idle' } : { status: 'error', query: text });
    }
  }, []);

  // Search after a pause in typing; numbers and links straight away.
  useEffect(() => {
    const text = query.trim();
    if (!userId || !shouldSearchServer(text)) {
      searchSeq.current += 1; // any answer still in flight is now stale
      setSearch({ status: 'idle' });
      return;
    }
    const delay = isCompleteQuery(text) ? 0 : SEARCH_DEBOUNCE_MS;
    const timer = window.setTimeout(() => void runSearch(text), delay);
    return () => window.clearTimeout(timer);
  }, [userId, query, runSearch]);

  /**
   * Hide a suggestion at once, then tell the server. Resolves to an `undo` that
   * clears the dismissal and puts the row back where it was, or rejects (with
   * the row already restored) when the server refused.
   */
  const dismiss = useCallback(
    async (issue: RedmineRelevantIssue): Promise<() => Promise<void>> => {
      const position = suggestionsRef.current.issues.findIndex((row) => row.id === issue.id);
      commitSuggestions((prev) => ({
        ...prev,
        issues: prev.issues.filter((row) => row.id !== issue.id),
      }));

      const restore = () =>
        commitSuggestions((prev) => {
          if (prev.issues.some((row) => row.id === issue.id)) return prev;
          const issues = [...prev.issues];
          issues.splice(position < 0 ? issues.length : position, 0, issue);
          return { ...prev, issues };
        });

      try {
        await redmineApi.prefs.set(issue.id, 'dismissed');
      } catch (err) {
        restore();
        throw err;
      }

      return async () => {
        await redmineApi.prefs.set(issue.id, null);
        restore();
      };
    },
    [commitSuggestions],
  );

  return {
    suggestions,
    search,
    loadSuggestions,
    retrySuggestions: () => loadSuggestions({ force: true }),
    retrySearch: () => void runSearch(query.trim()),
    dismiss,
  };
}
