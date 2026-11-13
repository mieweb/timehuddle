/**
 * A row of chrome that folds away (height and fade) while `hidden`, e.g. as a
 * list scrolls (see `useHideOnScroll`). Folded, it is inert: its controls
 * leave the tab order and the accessibility tree until it opens again.
 *
 * `className` (padding, say) goes on the content, inside the part that folds:
 * a box can't shrink below its own padding, so padding on the folding part
 * would stay behind as empty space.
 */
import { cn } from '@mieweb/ui';
import React from 'react';

export const TuckAway: React.FC<{
  hidden: boolean;
  className?: string;
  children: React.ReactNode;
}> = ({ hidden, className, children }) => (
  <div
    className={cn(
      'tuck-away grid shrink-0 transition-[grid-template-rows,opacity] duration-200 ease-out',
      hidden ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100',
    )}
    inert={hidden}
  >
    <div className="tuck-away-fold min-h-0 overflow-hidden">
      <div className={cn('tuck-away-content', className)}>{children}</div>
    </div>
  </div>
);
