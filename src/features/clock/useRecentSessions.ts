/**
 * Fetches this user's completed sessions for a team and derives the
 * Today/Last-7-days totals shown beside the Clock page's timer.
 *
 * Re-fetches whenever clocked-in state flips so a just-finished session shows
 * up immediately. `nowMs` is the caller's own live clock (e.g. TeamContext's
 * `currentTime`) — passed in rather than read internally so the totals keep
 * rolling forward (midnight, the 7-day window) on a page left open, not just
 * whenever `sessions` happens to change.
 *
 * The session list itself stays completed-only (that's what gets grouped and
 * listed), but `activeClockEvent`'s live worked time — when it's for this
 * same team — is folded into the totals. Otherwise "Today" reads 0m for the
 * first hours of someone's first shift of the day, even as the big timer
 * right above it ticks up. Like a completed shift, it counts toward the day
 * it started (see `getTodayAndLast7DaysSeconds`).
 */
import { useEffect, useMemo, useState } from 'react';

import { clockApi, type ClockEvent } from '../../lib/api';
import { getActiveClockSeconds } from '../../lib/timeUtils';
import { getTodayAndLast7DaysSeconds } from './recentSessions';

export function useRecentSessions(
  teamId: string | null | undefined,
  activeClockEvent: ClockEvent | null | undefined,
  nowMs: number,
) {
  const isClockedIn = !!activeClockEvent;
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
      // A failed refresh keeps the last good history rather than zeroing the
      // totals; `teamSessions` below still hides it if it's another team's.
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [teamId, isClockedIn]);

  // Until a team switch's fetch lands, `sessions` still holds the previous
  // team's events — filtered here so they never show as this team's hours.
  const teamSessions = useMemo(
    () => sessions.filter((session) => session.teamId === teamId),
    [sessions, teamId],
  );

  // The completed history only needs recomputing once a minute — often enough
  // that the totals don't go stale across midnight or as sessions age out of
  // the rolling 7-day window on a page left open.
  const minuteKey = Math.floor(nowMs / 60000);
  const completedTotals = useMemo(
    () => getTodayAndLast7DaysSeconds(teamSessions, new Date(minuteKey * 60000)),
    [teamSessions, minuteKey],
  );

  // The live shift is added at full precision every tick, through the same
  // day/window rule, so it keeps pace with the timer and nothing is rounded
  // until the final total is formatted.
  const liveTotals =
    activeClockEvent && activeClockEvent.teamId === teamId
      ? getTodayAndLast7DaysSeconds([], new Date(nowMs), {
          startTime: activeClockEvent.startTime,
          seconds: getActiveClockSeconds(activeClockEvent, nowMs),
        })
      : { todaySeconds: 0, last7DaysSeconds: 0 };

  const todaySeconds = completedTotals.todaySeconds + liveTotals.todaySeconds;
  const last7DaysSeconds = completedTotals.last7DaysSeconds + liveTotals.last7DaysSeconds;

  return { sessions: teamSessions, loading, todaySeconds, last7DaysSeconds };
}
