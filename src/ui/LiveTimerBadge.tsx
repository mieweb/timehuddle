/**
 * LiveTimerBadge — a running timer's elapsed time as a `Badge`, ticking every
 * second on its own, so the list it sits in doesn't re-render each second.
 *
 * Not a live region: screen readers aren't told the time every second. Its
 * accessible name says what it is; the time is read when someone reaches it.
 */
import { Badge } from '@mieweb/ui';
import { Timer } from 'lucide-react';
import React from 'react';

import { formatTimer } from '../lib/timeUtils';
import { useNow } from '../lib/useNow';

export interface LiveTimerBadgeProps {
  /** When the timer started, epoch ms. */
  since: number;
  /** What the timer is, for assistive tech, e.g. "Timer running". */
  label: string;
  className?: string;
}

export const LiveTimerBadge: React.FC<LiveTimerBadgeProps> = ({ since, label, className }) => {
  const now = useNow();
  return (
    <Badge
      variant="success"
      size="sm"
      className={`live-timer-badge tabular-nums ${className ?? ''}`}
    >
      <Timer className="me-1 h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="sr-only">{label} </span>
      {formatTimer((now - since) / 1000)}
    </Badge>
  );
};
