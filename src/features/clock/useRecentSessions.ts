/**
 * Fetches this user's completed sessions for a team and derives the
 * Today/Last-7-days totals shown beside the Clock page's timer.
 *
 * Re-fetches whenever the active shift changes (clocking in or out, or one
 * shift replaced by another) so a just-finished session shows up immediately. `nowMs` is the caller's own live clock (e.g. TeamContext's
 * `currentTime`) — passed in rather than read internally so the totals keep
 * rolling forward (midnight, the 7-day window) on a page left open, not just
 * whenever `sessions` happens to change.
 *
 * The session list itself stays completed-only (that's what gets grouped and
 * listed), but two shifts outside it are folded into the totals:
 * - `activeClockEvent`'s live worked time, when it's for this same team.
 *   Otherwise "Today" reads 0m for the first hours of someone's first shift
 *   of the day, even as the big timer right above it ticks up.
 * - The shift just clocked out, until the refreshed list includes it.
 *   Otherwise the totals dip (3h → 0m → 3h) while it reloads, and stay low
 *   if that reload fails.
 * Like a completed shift, each counts toward the day it started (see
 * `getTodayAndLast7DaysSeconds`).
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import { clockApi, type ClockEvent } from '../../lib/api';
import { getActiveClockSeconds } from '../../lib/timeUtils';
import { getTodayAndLast7DaysSeconds, type ActiveShiftTotal } from './recentSessions';

// The server's cap on `clock.events`. The table and the totals both cover the
// last 7 calendar days, so the 8 the page once listed isn't enough. 100
// covers any realistic week while keeping the read narrowed to this team's
// finished sessions.
const RECENT_SESSIONS_FETCHED = 100;

/** A shift clocked out whose completed record hasn't been loaded yet. */
type FinishedShift = ActiveShiftTotal & { id: string; teamId: string };

export function useRecentSessions(
  teamId: string | null | undefined,
  activeClockEvent: ClockEvent | null | undefined,
  nowMs: number,
) {
  const activeShiftId = activeClockEvent?.id ?? null;
  const [sessions, setSessions] = useState<ClockEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [finishedShift, setFinishedShift] = useState<FinishedShift | null>(null);

  useEffect(() => {
    if (!teamId) {
      setSessions([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    clockApi
      .getRecentSessions(teamId, RECENT_SESSIONS_FETCHED)
      .then((events) => {
        if (cancelled) return;
        setSessions(events);
        // Its own record has loaded, so the copy is done; dropped here rather
        // than merely skipped, or a session deleted later would come back.
        setFinishedShift((shift) =>
          shift && events.some((event) => event.id === shift.id) ? null : shift,
        );
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
    // Keyed on the shift's id rather than just clocked-in/out, so a shift
    // replaced straight by another one also reloads the one that ended.
  }, [teamId, activeShiftId]);

  // The running shift as of the latest tick, so that when it ends — or is
  // replaced by another — its worked time carries on in the totals until its
  // completed record arrives.
  const lastActiveRef = useRef<FinishedShift | null>(null);
  useEffect(() => {
    const previous = lastActiveRef.current;
    if (previous && previous.id !== activeClockEvent?.id) setFinishedShift(previous);
    lastActiveRef.current = activeClockEvent
      ? {
          id: activeClockEvent.id,
          teamId: activeClockEvent.teamId,
          startTime: activeClockEvent.startTime,
          seconds: getActiveClockSeconds(activeClockEvent, nowMs),
        }
      : null;
  }, [activeClockEvent, nowMs]);

  // Until a team switch's fetch lands, `sessions` still holds the previous
  // team's events — filtered here so they never show as this team's hours.
  const teamSessions = useMemo(
    () => sessions.filter((session) => session.teamId === teamId),
    [sessions, teamId],
  );

  // The completed history only needs recomputing once a minute — often enough
  // that the totals don't go stale across midnight or as sessions age out of
  // the 7-day window on a page left open.
  const minuteKey = Math.floor(nowMs / 60000);
  const completedTotals = useMemo(
    () => getTodayAndLast7DaysSeconds(teamSessions, new Date(minuteKey * 60000)),
    [teamSessions, minuteKey],
  );

  // The live shift is added at full precision every tick, through the same
  // day/window rule, so it keeps pace with the timer and nothing is rounded
  // until the final total is formatted.
  const extraShifts: ActiveShiftTotal[] = [];
  if (activeClockEvent && activeClockEvent.teamId === teamId) {
    extraShifts.push({
      startTime: activeClockEvent.startTime,
      seconds: getActiveClockSeconds(activeClockEvent, nowMs),
    });
  }
  // Not when it's running again: a failed clock read clears the active shift
  // for a moment, and the next read brings the same one back, live.
  if (
    finishedShift &&
    finishedShift.teamId === teamId &&
    finishedShift.id !== activeClockEvent?.id &&
    !teamSessions.some((session) => session.id === finishedShift.id)
  ) {
    extraShifts.push(finishedShift);
  }
  const extraTotals = getTodayAndLast7DaysSeconds([], new Date(nowMs), extraShifts);

  const todaySeconds = completedTotals.todaySeconds + extraTotals.todaySeconds;
  const last7DaysSeconds = completedTotals.last7DaysSeconds + extraTotals.last7DaysSeconds;

  return { sessions: teamSessions, loading, todaySeconds, last7DaysSeconds };
}
