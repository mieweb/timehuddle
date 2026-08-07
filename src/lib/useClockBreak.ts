/**
 * useClockBreak — Start/end a break on the active clock session.
 *
 * Split out of useClockToggle so surfaces that only need Break/Resume — the
 * app header, for one — don't pay for the plan-first gate, which subscribes to
 * the team's huddle posts. useClockToggle re-exports these, so there is still
 * one implementation of the pause/resume calls.
 */
import { useCallback, useState } from 'react';

import { clockApi } from './api';
import { useTeam } from './TeamContext';

export function useClockBreak() {
  const { activeClockEvent, selectedTeamId, refetchClock } = useTeam();
  const [clockPauseLoading, setClockPauseLoading] = useState(false);

  const isPaused = !!activeClockEvent?.isPaused;

  // Always prefer the active event's teamId: the user may have switched teams
  // after clocking in, and the break belongs to the session, not the selection.
  const teamId = activeClockEvent?.teamId ?? selectedTeamId;

  const runBreakAction = useCallback(
    async (action: 'pause' | 'resume') => {
      if (!teamId) return;
      setClockPauseLoading(true);
      try {
        await (action === 'pause' ? clockApi.pause(teamId) : clockApi.resume(teamId));
        await refetchClock();
        // Notify all timer-displaying pages to refetch immediately
        window.dispatchEvent(new CustomEvent('work:refetch'));
        window.dispatchEvent(new CustomEvent('tickets:refetch'));
      } catch (err) {
        window.alert(
          err instanceof Error ? err.message : `Failed to ${action} clock. Please try again.`,
        );
      } finally {
        setClockPauseLoading(false);
      }
    },
    [teamId, refetchClock],
  );

  const pauseClock = useCallback(() => runBreakAction('pause'), [runBreakAction]);
  const resumeClock = useCallback(() => runBreakAction('resume'), [runBreakAction]);

  /** Whichever of pause/resume applies to the current state. */
  const toggleBreak = useCallback(
    () => runBreakAction(isPaused ? 'resume' : 'pause'),
    [runBreakAction, isPaused],
  );

  return { isPaused, pauseClock, resumeClock, toggleBreak, clockPauseLoading };
}
