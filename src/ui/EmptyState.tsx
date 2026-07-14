/**
 * EmptyState — The standard "nothing here yet" block.
 *
 * A centred icon, a title and an optional supporting line, so every page says
 * "nothing here" the same way.
 *
 * Centring is done twice on purpose. @mieweb/ui's Text defaults to
 * align="left", which emits `text-left` and silently overrides a parent's
 * `text-center` — the bug this component replaces, where the icon centred but
 * the words sat against the left edge. So the column centres the elements and
 * each Text sets its own alignment; either alone is not enough.
 */
import { cn, Text } from '@mieweb/ui';
import React from 'react';

interface EmptyStateProps {
  /** Decorative icon or emoji. Hidden from screen readers. */
  icon?: React.ReactNode;
  /** What is empty, e.g. "No activity yet". */
  title: string;
  /** How it gets filled, e.g. "Events like clocking in will appear here." */
  description?: string;
  /** Optional call to action. */
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  className,
}) => (
  <div
    className={cn(
      'empty-state flex flex-col items-center justify-center gap-3 px-4 py-16 text-center',
      className,
    )}
  >
    {icon && (
      <div className="text-4xl text-neutral-300 dark:text-neutral-600" aria-hidden>
        {icon}
      </div>
    )}

    <div className="space-y-1">
      <Text align="center" variant="muted" weight="medium">
        {title}
      </Text>
      {description && (
        <Text align="center" variant="muted" size="sm">
          {description}
        </Text>
      )}
    </div>

    {action}
  </div>
);
