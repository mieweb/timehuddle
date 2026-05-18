/**
 * ClockInHeaderTimer — Compact elapsed timer for the app header.
 *
 * Displays only when the user has an active clock event. Uses the Timer
 * component with an animated clock icon and live HH:MM:SS display.
 */
import React from 'react';

import { useTeam } from '../lib/TeamContext';
import { formatTimer, getActiveClockSeconds } from '../lib/timeUtils';
import { TimerRoot, TimerIcon, TimerDisplay } from './Timer';

export const ClockInHeaderTimer: React.FC = () => {
  const { activeClockEvent, currentTime } = useTeam();

  if (!activeClockEvent) return null;

  const elapsedSeconds = getActiveClockSeconds(activeClockEvent, currentTime);
  const display = formatTimer(elapsedSeconds);

  return (
    <TimerRoot
      variant="success"
      size="md"
      aria-live="polite"
      aria-label={`Clocked in, elapsed time ${display}`}
    >
      <TimerIcon size="md" loading />
      <TimerDisplay time={display} size="md" />
    </TimerRoot>
  );
};
