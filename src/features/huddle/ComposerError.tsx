/**
 * ComposerError — the composer's inline failure notice.
 *
 * Replaces the `alert()` calls these paths used to make. An alert blocks the
 * main thread, can't be styled or translated with the rest of the UI, and
 * throws the user out of the composer to dismiss it — losing the caret and,
 * on mobile, the keyboard. A `role="alert"` region is announced by screen
 * readers just as reliably and leaves the draft alone.
 */
import { Button } from '@mieweb/ui';

interface ComposerErrorProps {
  /** The message to show, or null when there's nothing wrong. */
  message: string | null;
  onDismiss: () => void;
}

export function ComposerError({ message, onDismiss }: ComposerErrorProps) {
  if (!message) return null;

  return (
    <div
      role="alert"
      data-testid="composer-error"
      className="mt-2 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800/50 dark:bg-red-950/30 dark:text-red-300"
    >
      <span className="flex-1">{message}</span>
      {/* `h-auto p-0` and `text-current` strip Button's own sizing and colour
          so the dismiss sits inline with the message rather than beside it as
          a full-height control. */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onDismiss}
        aria-label="Dismiss error"
        className="h-auto shrink-0 bg-transparent p-0 text-current hover:bg-transparent hover:text-red-900 dark:hover:bg-transparent dark:hover:text-red-200"
      >
        <svg
          className="h-3 w-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </Button>
    </div>
  );
}
