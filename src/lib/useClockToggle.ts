/**
 * useClockToggle — Shared clock-in / clock-out logic.
 *
 * Encapsulates the API calls, loading states, and the teamId guard (always
 * prefer the active event's teamId over the currently selected team, since the
 * user may have switched teams after clocking in).
 */
import { useCallback, useState } from 'react';

import { ApiError, clockApi } from './api';
import { useTeam } from './TeamContext';

export function useClockToggle() {
  const { activeClockEvent, selectedTeamId, refetchClock } = useTeam();

  const [clockInLoading, setClockInLoading] = useState(false);
  const [clockOutLoading, setClockOutLoading] = useState(false);
  const [clockPauseLoading, setClockPauseLoading] = useState(false);
  // Set when clock-out is refused by the plan-first gate ('plan-required');
  // pages render it inline with a link to Huddle instead of an alert.
  const [clockOutBlockedReason, setClockOutBlockedReason] = useState<string | null>(null);

  const isClockedIn = !!activeClockEvent;

  const clockIn = useCallback(async () => {
    if (!selectedTeamId) return;
    setClockInLoading(true);
    try {
      await clockApi.start(selectedTeamId);
      await refetchClock();
    } finally {
      setClockInLoading(false);
    }
  }, [selectedTeamId, refetchClock]);

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
  };
}
