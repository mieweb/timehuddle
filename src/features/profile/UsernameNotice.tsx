/**
 * UsernameNotice — Inline banner shown on profile surfaces when the user's
 * username is in a "required action" state (pending claim, blocked, etc.).
 *
 * Intentionally kept small and dependency-light so it can be dropped into any
 * profile-adjacent surface without overhead.
 */
import { faCircleExclamation } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button } from '@mieweb/ui';
import React from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

/** The current state of the user's username claim. */
export type UsernameState = 'pending' | 'blocked' | 'required';

interface UsernameNoticeProps {
  /** The reason the notice is being shown. */
  state: UsernameState;
  /** Optional callback when the user clicks the action link. */
  onAction?: () => void;
}

// ─── Copy map ─────────────────────────────────────────────────────────────────

const COPY: Record<UsernameState, { message: string; action: string }> = {
  pending: {
    message: 'Your username is being reviewed.',
    action: 'Check status',
  },
  blocked: {
    message: 'Your requested username is unavailable.',
    action: 'Choose a different username',
  },
  required: {
    message: 'Set a username to complete your profile.',
    action: 'Choose a username',
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Shows a small warning banner with an actionable link.
 * Displayed on profile-related surfaces whenever the user's username state
 * requires attention.
 */
export const UsernameNotice: React.FC<UsernameNoticeProps> = ({ state, onAction }) => {
  const { message, action } = COPY[state];

  return (
    <div
      role="status"
      aria-live="polite"
      className="username-notice flex items-center gap-2 rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-800 dark:border-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-300"
    >
      <FontAwesomeIcon
        icon={faCircleExclamation}
        className="shrink-0 text-yellow-500 dark:text-yellow-400"
        aria-hidden="true"
      />
      <span>{message}</span>
      {onAction && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onAction}
          className="ml-auto whitespace-nowrap font-medium underline underline-offset-2 hover:no-underline"
          aria-label={`${action} — username action required`}
        >
          {action}
        </Button>
      )}
    </div>
  );
};
