/**
 * TimerToggleButton — Shared start/stop timer button.
 *
 * Reused across WorkPage and TicketsPage for consistent timer controls.
 */
import { faPause, faPlay } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button } from '@mieweb/ui';
import React from 'react';

export interface TimerToggleButtonProps {
  isRunning: boolean;
  isLoading?: boolean;
  disabled?: boolean;
  onClick: () => void;
  ariaLabel?: string;
  title?: string;
}

export const TimerToggleButton: React.FC<TimerToggleButtonProps> = ({
  isRunning,
  isLoading = false,
  disabled = false,
  onClick,
  ariaLabel,
  title,
}) => {
  const buttonContent = (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      disabled={disabled || isLoading}
      className={`rounded-full ${
        isRunning
          ? 'bg-amber-100 text-amber-600 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-400'
          : 'bg-green-100 text-green-600 hover:bg-green-200 dark:bg-green-900/40 dark:text-green-400'
      }`}
      aria-label={ariaLabel ?? (isRunning ? 'Stop timer' : 'Start timer')}
      style={disabled && !isLoading ? { pointerEvents: 'none' } : undefined}
    >
      <FontAwesomeIcon icon={isRunning ? faPause : faPlay} className="text-xs" />
    </Button>
  );

  // Wrap in a title span if disabled to show tooltip
  if (disabled && title) {
    return (
      <span title={title} style={{ cursor: 'not-allowed' }}>
        {buttonContent}
      </span>
    );
  }

  return buttonContent;
};
