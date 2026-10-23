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

  // Until a team switch's fetch lands, `sessions` still holds the previous
  // team's events — filtered here so they never show as this team's hours.
  const teamSessions = useMemo(
    () => sessions.filter((session) => session.teamId === teamId),
    [sessions, teamId],
  );

  // Rounded to the minute: Today/Last-7-days only ever display at minute
  // precision, so there's no need to recompute on the caller's per-second
  // tick — just often enough that the totals don't go stale across midnight
  // or as sessions age out of the rolling 7-day window on a page left open.
  // The live shift is measured from the exact `nowMs` and then floored to
  // whole minutes, so it keeps pace with the timer, whose minutes don't line
  // up with the wall clock's.
  const minuteKey = Math.floor(nowMs / 60000);
  const isActiveHere = !!activeClockEvent && activeClockEvent.teamId === teamId;
  const activeStartTime = isActiveHere ? activeClockEvent.startTime : null;
  const liveSeconds = isActiveHere
    ? Math.floor(getActiveClockSeconds(activeClockEvent, nowMs) / 60) * 60
    : 0;
  const { todaySeconds, last7DaysSeconds } = useMemo(
    () =>
      getTodayAndLast7DaysSeconds(
        teamSessions,
        new Date(minuteKey * 60000),
        activeStartTime == null ? null : { startTime: activeStartTime, seconds: liveSeconds },
      ),
    [teamSessions, minuteKey, activeStartTime, liveSeconds],
  );

  return { sessions: teamSessions, loading, todaySeconds, last7DaysSeconds };
}
