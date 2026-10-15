/**
 * Fetches this user's completed sessions for a team and derives the
 * Today/Last-7-days totals shown beside the Clock page's timer.
 *
 * Re-fetches whenever `isClockedIn` flips so a just-finished session shows up
 * immediately. `nowMs` is the caller's own live clock (e.g. TeamContext's
 * `currentTime`) — passed in rather than read internally so the totals keep
 * rolling forward (midnight, the 7-day window) on a page left open, not just
 * whenever `sessions` happens to change.
 */
import { useEffect, useMemo, useState } from 'react';

import { clockApi, type ClockEvent } from '../../lib/api';
import { getTodayAndLast7DaysSeconds } from './recentSessions';

export function useRecentSessions(
  teamId: string | null | undefined,
  isClockedIn: boolean,
  nowMs: number,
) {
  const [sessions, setSessions] = useState<ClockEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!teamId) {
      setSessions([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    clockApi
      .getEvents()
      .then((events) => {
        if (cancelled) return;
        const completed = events
          .filter((e) => e.teamId === teamId && e.endTime != null)
          .sort((a, b) => b.startTime - a.startTime);
        setSessions(completed);
      })
      .catch(() => {
        if (!cancelled) setSessions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [teamId, isClockedIn]);

  // Rounded to the minute: Today/Last-7-days only ever display at minute
  // precision, so there's no need to recompute on the caller's per-second
  // tick — just often enough that the totals don't go stale across midnight
  // or as sessions age out of the rolling 7-day window on a page left open.
  const minuteKey = Math.floor(nowMs / 60000);
  const { todaySeconds, last7DaysSeconds } = useMemo(
    () => getTodayAndLast7DaysSeconds(sessions, new Date(minuteKey * 60000)),
    [sessions, minuteKey],
  );

  return { sessions, loading, todaySeconds, last7DaysSeconds };
}
