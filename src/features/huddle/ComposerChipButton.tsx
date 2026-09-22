/**
 * ComposerChipButton — the one pill used by every control in the composer's
 * attach bar (Photo, Video, Doc, Pulse, Ticket, @Mention).
 *
 * It exists because `@mieweb/ui`'s `Button` has no neutral bordered variant:
 * `outline` is hard-wired to the brand primary (`border-primary-800
 * text-primary-800`), so asking for a plain outlined chip gets you an orange
 * one. Each control had worked around that separately — Photo/Video/Doc took
 * the orange `outline`, Ticket used `ghost` plus a hand-written border, and
 * Pulse and @Mention dropped to raw `<button>` elements — which is why one row
 * of six chips rendered in two different colours.
 *
 * `ghost` plus the border below is that reconciliation, in one place. If
 * @mieweb/ui gains a neutral outline variant, this collapses to it.
 */
import { Button } from '@mieweb/ui';
import { forwardRef, type ReactElement, type ReactNode } from 'react';

interface ComposerChipButtonProps {
  children: ReactNode;
  /** Icon rendered before the label — size it `w-3.5 h-3.5` to match its peers. */
  leftIcon?: ReactElement;
  onClick?: () => void;
  disabled?: boolean;
  /** Set while the chip's own work is in flight (e.g. an upload). */
  'aria-busy'?: boolean;
  'aria-haspopup'?: 'menu';
  'aria-expanded'?: boolean;
  /** Only where the visible label isn't already a sufficient accessible name. */
  'aria-label'?: string;
}

export const ComposerChipButton = forwardRef<HTMLButtonElement, ComposerChipButtonProps>(
  function ComposerChipButton({ children, leftIcon, onClick, disabled, ...aria }, ref) {
    return (
      <Button
        ref={ref}
        type="button"
        variant="ghost"
        size="sm"
        onClick={onClick}
        disabled={disabled}
        leftIcon={leftIcon}
        className="gap-1.5 rounded-full border border-gray-200 px-3 py-1.5 text-xs font-normal text-gray-500 hover:bg-gray-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-700"
        {...aria}
      >
        {children}
      </Button>
    );
  },
);
