/**
 * useClockToggle — Shared clock-in / clock-out logic.
 *
 * Encapsulates the API calls, loading states, the teamId guard (always
 * prefer the active event's teamId over the currently selected team, since
 * the user may have switched teams after clocking in), and the plan-first
 * gates — so every clock surface (clock page, bottom-nav FAB, work/tickets
 * clock-in prompts) enforces them consistently.
 */
import { useCallback, useState } from 'react';

import { ApiError, clockApi } from './api';
import { useDailyPost } from './useDailyPost';
import { useTeam } from './TeamContext';

export function useClockToggle() {
  const { teams, activeClockEvent, selectedTeamId, selectedTeam, refetchClock } = useTeam();

  const [clockInLoading, setClockInLoading] = useState(false);
  const [clockOutLoading, setClockOutLoading] = useState(false);
  const [clockPauseLoading, setClockPauseLoading] = useState(false);
  // Set when clock-out is refused by the plan-first gate ('plan-required');
  // pages render it inline with a link to Huddle instead of an alert.
  const [clockOutBlockedReason, setClockOutBlockedReason] = useState<string | null>(null);

  const isClockedIn = !!activeClockEvent;

  // ── Plan-first gates (team setting, default off) ──
  // Clock In targets the selected team; Clock Out targets the team of the
  // active session (which may differ if the user switched teams after
  // clocking in). Gate against whichever applies.
  const gateTeamId = activeClockEvent?.teamId ?? selectedTeamId;
  const gateTeam = activeClockEvent
    ? (teams.find((t) => t.id === activeClockEvent.teamId) ?? null)
    : selectedTeam;
  const requirePlan = !!gateTeam?.settings?.requirePlanForClock;
  // Only subscribe to today's post when the gate is actually on.
  const { todayPost } = useDailyPost(requirePlan ? gateTeamId : null);
  // Clock In requires today's post to exist.
  const planMissing = !activeClockEvent && requirePlan && !todayPost;
  // Clock Out requires today's post (in the active session's team) to have a wrap-up.
  const wrapUpMissing = !!activeClockEvent && requirePlan && (!todayPost || !todayPost.wrapUpAt);

  const clockIn = useCallback(async () => {
    // planMissing: the plan-first gate refuses clock-in until today's plan
    // is posted — callers disable their buttons and/or show the hint.
    if (!selectedTeamId || planMissing) return false;
    setClockInLoading(true);
    try {
      await clockApi.start(selectedTeamId);
      await refetchClock();
      return true;
    } finally {
      setClockInLoading(false);
    }
  }, [selectedTeamId, planMissing, refetchClock]);

  const clockOut = useCallback(async () => {
    const teamId = activeClockEvent?.teamId ?? selectedTeamId;
    if (!teamId) return false;
    setClockOutLoading(true);
    setClockOutBlockedReason(null);
    try {
      await clockApi.stop(teamId);
      await refetchClock();
      // Notify all timer-displaying pages to refetch immediately
      window.dispatchEvent(new CustomEvent('work:refetch'));
      window.dispatchEvent(new CustomEvent('tickets:refetch'));
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.code === 'plan-required') {
        setClockOutBlockedReason(err.message);
      } else {
        window.alert(
          err instanceof Error ? err.message : 'Failed to clock out. Please try again.',
        );
      }
      return false;
    } finally {
      setClockOutLoading(false);
    }
  }, [activeClockEvent, selectedTeamId, refetchClock]);

  const pauseClock = useCallback(async () => {
    const teamId = activeClockEvent?.teamId ?? selectedTeamId;
    if (!teamId) return;
    setClockPauseLoading(true);
    try {
      await clockApi.pause(teamId);
      await refetchClock();
      // Notify all timer-displaying pages to refetch immediately
      window.dispatchEvent(new CustomEvent('work:refetch'));
      window.dispatchEvent(new CustomEvent('tickets:refetch'));
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to pause clock. Please try again.');
    } finally {
      setClockPauseLoading(false);
    }
  }, [activeClockEvent, selectedTeamId, refetchClock]);

  const resumeClock = useCallback(async () => {
    const teamId = activeClockEvent?.teamId ?? selectedTeamId;
    if (!teamId) return;
    setClockPauseLoading(true);
    try {
      await clockApi.resume(teamId);
      await refetchClock();
      // Notify all timer-displaying pages to refetch immediately
      window.dispatchEvent(new CustomEvent('work:refetch'));
      window.dispatchEvent(new CustomEvent('tickets:refetch'));
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : 'Failed to resume clock. Please try again.',
      );
    } finally {
      setClockPauseLoading(false);
    }
  }, [activeClockEvent, selectedTeamId, refetchClock]);

  return {
    isClockedIn,
    clockIn,
    clockOut,
    pauseClock,
    resumeClock,
    clockInLoading,
    clockOutLoading,
    clockPauseLoading,
    clockOutBlockedReason,
    /** Plan-first gate state for the team the next clock action targets. */
    planGate: {
      teamId: gateTeamId,
      teamName: gateTeam?.name ?? null,
      todayPost,
      planMissing,
      wrapUpMissing,
    },
  };
}
