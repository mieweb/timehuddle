/**
 * useClockToggle — Shared clock-in / clock-out logic.
 *
 * Encapsulates the API calls, loading states, and the teamId guard (always
 * prefer the active event's teamId over the currently selected team, since the
 * user may have switched teams after clocking in).
 */
import { useCallback, useState } from 'react';

import { clockApi } from './api';
import { useTeam } from './TeamContext';

export function useClockToggle() {
  const { activeClockEvent, selectedTeamId, refetchClock } = useTeam();

  const [clockInLoading, setClockInLoading] = useState(false);
  const [clockOutLoading, setClockOutLoading] = useState(false);

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
    if (!teamId) return;
    setClockOutLoading(true);
    try {
      await clockApi.stop(teamId);
      await refetchClock();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to clock out. Please try again.');
    } finally {
      setClockOutLoading(false);
    }
  }, [activeClockEvent, selectedTeamId, refetchClock]);

  return { isClockedIn, clockIn, clockOut, clockInLoading, clockOutLoading };
}
