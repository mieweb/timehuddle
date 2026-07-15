/**
 * ClockInHeaderTimer — Compact elapsed timer for the app header.
 *
 * Displays only when the user has an active clock event. Uses the Timer
 * component with an animated clock icon and live HH:MM:SS display.
 * Tapping opens the clock in/out page.
 */
import React, { useCallback } from 'react';

import { useTeam } from '../lib/TeamContext';
import { formatTimer, getActiveClockSeconds } from '../lib/timeUtils';
import { useRouter } from './router';
import { TimerRoot, TimerIcon, TimerDisplay } from './Timer';

export const ClockInHeaderTimer: React.FC = () => {
  const { navigate } = useRouter();
  const { activeClockEvent, currentTime } = useTeam();

  const goToClock = useCallback(() => {
    navigate('/app/clock');
  }, [navigate]);

  if (!activeClockEvent) return null;

  const elapsedSeconds = getActiveClockSeconds(activeClockEvent, currentTime);
  const display = formatTimer(elapsedSeconds);

  return (
    <TimerRoot
      variant="success"
      size="md"
      role="button"
      tabIndex={0}
      aria-live="polite"
      aria-label={`Clocked in, elapsed time ${display}. Open clock page.`}
      className="cursor-pointer hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-500"
      onClick={goToClock}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          goToClock();
        }
      }}
    >
      <TimerIcon size="md" loading />
      {/* Below sm the header also carries the page title and the org/team
          switcher; the elapsed digits yield so those stay legible. The icon
          still signals "clocked in", the aria-label above still announces the
          time, and the tab title carries it too (useClockDocumentTitle). */}
      <TimerDisplay time={display} size="md" className="hidden sm:block" />
    </TimerRoot>
  );
};
