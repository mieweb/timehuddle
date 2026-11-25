/**
 * TimePill — a ticket's time as a `Badge` pill: green and ticking while its
 * timer runs, outlined and frozen while it's paused. One look for a ticket's
 * time wherever it shows (today's plan on the Clock page, My Board's rows).
 *
 * Only the ticking time re-renders each second, not the list it sits in. Not
 * a live region: screen readers aren't told the time every second; its name
 * says whose time it is and whether it runs.
 */
import { Badge } from '@mieweb/ui';
import React from 'react';

import { formatTimer } from '../lib/timeUtils';
import { useNow } from '../lib/useNow';

const LiveTime: React.FC<{ since: number }> = ({ since }) => {
  const now = useNow();
  return <>{formatTimer((now - since) / 1000)}</>;
};

export interface TimePillProps {
  /** Epoch ms the time counts from while running; null while paused. */
  runningSince: number | null;
  /** The time so far, shown frozen while paused. */
  seconds?: number;
  /** Its accessible name, e.g. "Time on TH-1 this session, running". */
  label: string;
  className?: string;
}

export const TimePill: React.FC<TimePillProps> = ({
  runningSince,
  seconds = 0,
  label,
  className = '',
}) => {
  const running = runningSince !== null;
  return (
    <Badge
      variant={running ? 'success' : 'outline'}
      size="sm"
      role="timer"
      aria-live="off"
      aria-label={label}
      data-running={running}
      className={`time-pill shrink-0 font-mono tabular-nums ${running ? '' : 'text-muted-foreground'} ${className}`}
    >
      {running ? <LiveTime since={runningSince} /> : formatTimer(seconds)}
    </Badge>
  );
};
