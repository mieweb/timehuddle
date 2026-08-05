/**
 * ClockInHeaderTimer — Compact elapsed timer for the app header.
 *
 * Displays only when the user has an active clock event. A compact gradient
 * strand sits beside the live HH:MM:SS display, so a glance tells you the clock
 * is actually counting; on break the count freezes and the strand flattens.
 * Above md the header runs a full-width strand of its own, so this one steps
 * aside there. Tapping opens the clock in/out page.
 */
import React, { useCallback } from 'react';

import { useTeam } from '../lib/TeamContext';
import { formatTimer, getActiveClockSeconds } from '../lib/timeUtils';
import { useRouter } from './router';
import { TimerRoot, TimerDisplay } from './Timer';

export const ClockInHeaderTimer: React.FC = () => {
  const { navigate } = useRouter();
  const { activeClockEvent, currentTime } = useTeam();

  const goToClock = useCallback(() => {
    navigate('/app/clock');
  }, [navigate]);

  if (!activeClockEvent) return null;

  const elapsedSeconds = getActiveClockSeconds(activeClockEvent, currentTime);
  const display = formatTimer(elapsedSeconds);
  // getActiveClockSeconds freezes the count while paused, so the pill must not
  // keep animating as though it were running — the strand goes flat, which is
  // what marks "on break" here. The pill itself stays neutral in both states:
  // the green "success" fill fought the gradient beside it.
  const isPaused = !!activeClockEvent.isPaused;

  return (
    <TimerRoot
      variant="outline"
      size="md"
      role="button"
      tabIndex={0}
      aria-live="polite"
      aria-label={
        isPaused
          ? `On break, elapsed time ${display}. Open clock page.`
          : `Clocked in, elapsed time ${display}. Open clock page.`
      }
      className="cursor-pointer hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2"
      onClick={goToClock}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          goToClock();
        }
      }}
    >
      <TimerDisplay time={display} size="md" />
    </TimerRoot>
  );
};
