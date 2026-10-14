/**
 * Fetches this user's completed sessions for a team and derives the
 * Today/Last-7-days totals shown beside the Clock page's timer.
 *
 * Re-fetches whenever `isClockedIn` flips so a just-finished session shows up
 * immediately.
 */
import { useEffect, useMemo, useState } from 'react';

import { clockApi, type ClockEvent } from '../../lib/api';
import { getTodayAndLast7DaysSeconds } from './recentSessions';

export function useRecentSessions(teamId: string | null | undefined, isClockedIn: boolean) {
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

  const { todaySeconds, last7DaysSeconds } = useMemo(
    () => getTodayAndLast7DaysSeconds(sessions, new Date()),
    [sessions],
  );

  return { sessions, loading, todaySeconds, last7DaysSeconds };
}
