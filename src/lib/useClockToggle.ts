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
import { useSessionPost } from './useSessionPost';
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

  // ── Plan-first gates (team setting, default off) — per session ──
  // Clock In targets the selected team; Clock Out targets the team of the
  // active session (which may differ if the user switched teams after
  // clocking in). Gate against whichever applies.
  const gateTeamId = activeClockEvent?.teamId ?? selectedTeamId;
  const gateTeam = activeClockEvent
    ? (teams.find((t) => t.id === activeClockEvent.teamId) ?? null)
    : selectedTeam;
  const requirePlan = !!gateTeam?.settings?.requirePlanForClock;
  // The published post linked to THIS clock session (one post per session).
  const { sessionPost } = useSessionPost(
    requirePlan ? gateTeamId : null,
    activeClockEvent?.id ?? null,
  );
  // Every session needs a fresh plan: Clock In is gated whenever the setting
  // is on and no session is active (the plan composer is always shown).
  const planMissing = !activeClockEvent && requirePlan;
  // Clock Out requires this session's post to have a wrap-up.
  const wrapUpMissing =
    !!activeClockEvent && requirePlan && (!sessionPost || !sessionPost.wrapUpAt);

  const clockIn = useCallback(
    async (opts?: { planJustPosted?: boolean; planPostId?: string }) => {
      // planMissing: the per-session gate refuses a bare clock-in until a plan
      // is posted for this session. The combined "post plan and clock in" flow
      // passes planJustPosted (+ planPostId to link the plan to the session).
      if (!selectedTeamId || (planMissing && !opts?.planJustPosted)) return false;
      setClockInLoading(true);
      try {
        await clockApi.start(selectedTeamId, opts?.planPostId);
        await refetchClock();
        return true;
      } finally {
        setClockInLoading(false);
      }
    },
    [selectedTeamId, planMissing, refetchClock],
  );

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
      requirePlan,
      /** The published post for the active clock session (per-session gate). */
      sessionPost,
      planMissing,
      wrapUpMissing,
    },
  };
}
