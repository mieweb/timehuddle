/**
 * BoardToggleButton — puts one ticket on My Board, or takes it off.
 *
 * The same button wherever a ticket is shown (the Tickets tables, the search
 * suggestions, both ticket pages), beside `TimerToggleButton`. It shows whether
 * the ticket is on the board, and a press changes that. The caller does the
 * write (`useBoardActions`).
 */
import { Button, Tooltip } from '@mieweb/ui';
import { ClipboardCopy, ClipboardX } from 'lucide-react';
import React from 'react';

import { boardText } from './boardStrings';

export interface BoardToggleButtonProps {
  onBoard: boolean;
  isLoading?: boolean;
  disabled?: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  /** Names the ticket: "Add #42 to My Board". Falls back to the bare action. */
  ariaLabel?: string;
  /** Show the state in words beside the icon, for a roomier spot like a page header. */
  showLabel?: boolean;
  className?: string;
  /**
   * For a button inside a combobox option, which cannot hold focusable
   * controls: see `TimerToggleButton`.
   */
  tabIndex?: number;
  'aria-hidden'?: boolean;
  onMouseDown?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

export const BoardToggleButton: React.FC<BoardToggleButtonProps> = ({
  onBoard,
  isLoading = false,
  disabled = false,
  onClick,
  ariaLabel,
  showLabel = false,
  className = '',
  tabIndex,
  'aria-hidden': ariaHidden,
  onMouseDown,
}) => {
  // The icon is what a press does: copy the ticket onto the board, or take it off.
  const Icon = onBoard ? ClipboardX : ClipboardCopy;
  const tooltip = onBoard ? boardText.onBoard : boardText.add;
  return (
    <Tooltip content={tooltip}>
      <Button
        variant="ghost"
        size={showLabel ? 'sm' : 'icon'}
        onClick={onClick}
        onMouseDown={onMouseDown}
        tabIndex={tabIndex}
        aria-hidden={ariaHidden}
        disabled={disabled || isLoading}
        // The label span is inline by default, which sits the icon on the text
        // baseline; as in `TimerToggleButton`, a flex label centres it.
        className={`board-toggle-button rounded-full [&_[data-slot=button-label]]:flex [&_[data-slot=button-label]]:items-center [&_[data-slot=button-label]]:gap-1.5 ${
          onBoard
            ? 'bg-primary/10 text-primary hover:bg-primary/20'
            : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
        } ${className}`}
        aria-label={ariaLabel ?? (onBoard ? boardText.onBoardShort : boardText.add)}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {showLabel && (
          <span className="board-toggle-label">
            {onBoard ? boardText.onBoardShort : boardText.addShort}
          </span>
        )}
      </Button>
    </Tooltip>
  );
};
