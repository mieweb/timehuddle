/**
 * TimerToggleButton — Shared start/stop timer button.
 *
 * Reused across WorkPage, TicketsPage, the Redmine search suggestions and the
 * Redmine issue page for consistent timer controls.
 */
import { Button, Tooltip } from '@mieweb/ui';
import { Pause, Play } from 'lucide-react';
import React from 'react';

export interface TimerToggleButtonProps {
  isRunning: boolean;
  isLoading?: boolean;
  disabled?: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  ariaLabel?: string;
  title?: string;
  /** Visible text beside the icon, for a roomier spot like a page header. */
  label?: string;
  className?: string;
  /**
   * For a button inside a combobox option, which cannot hold focusable
   * controls: take it out of the tab order and hide it from assistive tech
   * (the keyboard gets a shortcut instead), and keep focus in the input.
   */
  tabIndex?: number;
  'aria-hidden'?: boolean;
  onMouseDown?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

export const TimerToggleButton: React.FC<TimerToggleButtonProps> = ({
  isRunning,
  isLoading = false,
  disabled = false,
  onClick,
  ariaLabel,
  title,
  label,
  className = '',
  tabIndex,
  'aria-hidden': ariaHidden,
  onMouseDown,
}) => {
  const Icon = isRunning ? Pause : Play;
  const buttonContent = (
    <Button
      variant="ghost"
      size={label ? 'sm' : 'icon'}
      onClick={onClick}
      onMouseDown={onMouseDown}
      tabIndex={tabIndex}
      aria-hidden={ariaHidden}
      disabled={disabled || isLoading}
      // `Button` wraps its content in an inline label span, which sits the icon
      // on the text baseline; a flex label centres it, and spaces it from `label`.
      className={`rounded-full [&_[data-slot=button-label]]:flex [&_[data-slot=button-label]]:items-center [&_[data-slot=button-label]]:gap-1.5 ${
        isRunning
          ? 'bg-amber-100 text-amber-600 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-400'
          : 'bg-green-100 text-green-600 hover:bg-green-200 dark:bg-green-900/40 dark:text-green-400'
      } ${className}`}
      aria-label={ariaLabel ?? (isRunning ? 'Stop timer' : 'Start timer')}
      style={disabled && !isLoading ? { pointerEvents: 'none' } : undefined}
    >
      {/* Filled, so it reads as a solid glyph at this size. */}
      <Icon className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
      {label && <span className="timer-toggle-label">{label}</span>}
    </Button>
  );

  if (!title) return buttonContent;

  // A disabled button gets no pointer events, so the tooltip hangs off a span.
  return (
    <Tooltip content={title}>
      {disabled ? (
        <span className="inline-flex" style={{ cursor: 'not-allowed' }}>
          {buttonContent}
        </span>
      ) : (
        buttonContent
      )}
    </Tooltip>
  );
};
