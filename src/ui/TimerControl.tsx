/**
 * TimerControl — the timer button with, while it runs, its live time under it.
 *
 * Wherever a ticket can be started (My Board rows, a ticket's page, today's
 * plan on the Clock page, the plan post in Huddle), the running one shows its
 * time right under its button, in front of the ticket. The time ticks on its
 * own and is not a live region, so screen readers aren't told every second.
 */
import React from 'react';

import { formatTimer } from '../lib/timeUtils';
import { useNow } from '../lib/useNow';
import { TimerToggleButton, type TimerToggleButtonProps } from './TimerToggleButton';

export interface TimerControlProps extends TimerToggleButtonProps {
  /** When the running time counts from, epoch ms; shown under the button while it runs. */
  runningSince?: number | null;
  /** The time's colour where the default doesn't read, e.g. `text-current` on a chat bubble. */
  timeClassName?: string;
  /**
   * The time takes its own width instead of overflowing the button's evenly.
   * For a spot with no column to keep aligned and an edge close by (a chat bubble).
   */
  timeTakesWidth?: boolean;
}

/** The running time alone, ticking every second. */
export const RunningTime: React.FC<{ since: number; className?: string }> = ({
  since,
  className = 'text-success',
}) => {
  const now = useNow();
  return (
    <span
      className={`timer-control-time font-mono text-[10px] leading-none tabular-nums ${className}`}
    >
      {formatTimer((now - since) / 1000)}
    </span>
  );
};

export const TimerControl: React.FC<TimerControlProps> = ({
  runningSince = null,
  timeClassName,
  timeTakesWidth = false,
  ...button
}) => (
  <span className="timer-control inline-flex shrink-0 flex-col items-center gap-0.5">
    <TimerToggleButton {...button} />
    {button.isRunning && runningSince !== null && (
      // No width of its own: wider than the button, it overflows both sides
      // evenly, so the ticket beside it stays where it was.
      <span className={`flex justify-center whitespace-nowrap ${timeTakesWidth ? '' : 'w-0'}`}>
        <RunningTime since={runningSince} className={timeClassName} />
      </span>
    )}
  </span>
);
