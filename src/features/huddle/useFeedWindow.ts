/**
 * useFeedWindow — how far back the Huddle feed reaches (#635).
 *
 * The feed loads the last 30 days; each time the reader reaches the end of the
 * conversation list the window widens by another 30. The window belongs to one
 * feed (a team, or the Personal view), so switching feeds starts a fresh one.
 * The fetchers report back what they found (`settle`), which is how the hook
 * learns whether anything older exists and when a load has finished.
 */
import { useCallback, useMemo, useRef, useState } from 'react';

export const WINDOW_INITIAL_DAYS = 30;
export const WINDOW_STEP_DAYS = 30;

/** ISO start of the local calendar day `days` ago. Day-aligned so it is stable within a day. */
export function windowSince(days: number, now: number = Date.now()): string {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days);
  return start.toISOString();
}

interface WindowState {
  key: string;
  days: number;
  /** Null until a fetch has reported. */
  hasMore: boolean | null;
  loadingOlder: boolean;
  loadFailed: boolean;
}

export type FeedOutcome = { ok: true; hasMore: boolean } | { ok: false };

const fresh = (key: string): WindowState => ({
  key,
  days: WINDOW_INITIAL_DAYS,
  hasMore: null,
  loadingOlder: false,
  loadFailed: false,
});

export function useFeedWindow(feedKey: string) {
  const [stored, setStored] = useState(() => fresh(feedKey));
  const feedKeyRef = useRef(feedKey);
  feedKeyRef.current = feedKey;

  // State left over from another feed reads as that feed's fresh window.
  const state = stored.key === feedKey ? stored : fresh(feedKey);
  // Huddle stays mounted, so the window must follow the calendar: keyed on the
  // local day, `since` moves forward after midnight instead of growing.
  const today = windowSince(0);
  const since = useMemo(() => windowSince(state.days), [state.days, today]);

  const update = useCallback(
    (key: string, change: (current: WindowState) => WindowState) =>
      setStored((prev) => {
        if (prev.key === key) return change(prev);
        // A report for a feed the reader has already left is dropped.
        return key === feedKeyRef.current ? change(fresh(key)) : prev;
      }),
    [],
  );

  /** Widen by one step. No-op while a load is running or failed, or with nothing older. */
  const loadOlder = useCallback(
    () =>
      update(feedKeyRef.current, (current) =>
        current.loadingOlder || current.loadFailed || !current.hasMore
          ? current
          : { ...current, days: current.days + WINDOW_STEP_DAYS, loadingOlder: true },
      ),
    [update],
  );

  /** Try the failed load again; the caller refetches, since `since` hasn't changed. */
  const retry = useCallback(
    () =>
      update(feedKeyRef.current, (current) => ({
        ...current,
        loadFailed: false,
        loadingOlder: true,
      })),
    [update],
  );

  /** A fetch for `key` finished: record whether older posts exist, or that it failed. */
  const settle = useCallback(
    (key: string, outcome: FeedOutcome) =>
      update(key, (current) =>
        outcome.ok
          ? { ...current, hasMore: outcome.hasMore, loadingOlder: false, loadFailed: false }
          : { ...current, loadingOlder: false, loadFailed: current.loadingOlder },
      ),
    [update],
  );

  return {
    since,
    days: state.days,
    hasMore: state.hasMore,
    loadingOlder: state.loadingOlder,
    loadFailed: state.loadFailed,
    loadOlder,
    retry,
    settle,
  };
}
