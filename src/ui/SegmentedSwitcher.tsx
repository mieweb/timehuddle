/**
 * A segmented switcher: every option stays visible, and a highlight slides to
 * the selected one.
 *
 * Composed here because @mieweb/ui has no segmented control: `PillSelect` is a
 * dropdown, `ViewSwitcher` only takes its own fixed view ids, and `Tabs` has no
 * moving indicator and implies panels (searched: segment, toggle, switch, pill,
 * tabs). The options are the library's `Button`, given the radio role.
 *
 * Keyboard model is a radio group: one tab stop, and the arrow keys move the
 * selection, since choosing is the whole interaction.
 */
import { Button } from '@mieweb/ui';
import { motion, useReducedMotion } from 'motion/react';
import React, { useRef } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedSwitcherProps<T extends string> {
  /** Accessible name of the group, also shown above it. */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  /** Unique on the page: it ties the sliding highlight to this switcher alone. */
  name: string;
  disabled?: boolean;
}

export function SegmentedSwitcher<T extends string>({
  label,
  options,
  value,
  onValueChange,
  name,
  disabled = false,
}: SegmentedSwitcherProps<T>) {
  const reducedMotion = useReducedMotion();
  const buttons = useRef(new Map<T, HTMLButtonElement>());

  const select = (next: T) => {
    if (next !== value) onValueChange(next);
    buttons.current.get(next)?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const index = options.findIndex((option) => option.value === value);
    // Left/right follow the reading direction, so they swap in right-to-left layouts.
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const step =
      event.key === 'ArrowDown' || event.key === (rtl ? 'ArrowLeft' : 'ArrowRight')
        ? 1
        : event.key === 'ArrowUp' || event.key === (rtl ? 'ArrowRight' : 'ArrowLeft')
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    select(options[(index + step + options.length) % options.length].value);
  };

  return (
    <div className="segmented-switcher space-y-1.5">
      <span
        id={`${name}-label`}
        className="segmented-switcher-label block text-sm font-medium text-neutral-900 dark:text-neutral-100"
      >
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={`${name}-label`}
        aria-disabled={disabled || undefined}
        onKeyDown={onKeyDown}
        className="segmented-switcher-track inline-flex max-w-full flex-wrap gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-800"
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Button
              key={option.value}
              ref={(node) => {
                if (node) buttons.current.set(option.value, node);
                else buttons.current.delete(option.value);
              }}
              type="button"
              variant="ghost"
              size="sm"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              disabled={disabled}
              onClick={() => select(option.value)}
              className={[
                // `hover:bg-transparent`: the sliding highlight is the only fill.
                'segmented-switcher-option relative h-auto rounded-md px-3 py-1.5 hover:bg-transparent dark:hover:bg-transparent',
                selected
                  ? 'text-primary-700 dark:text-primary-300'
                  : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100',
              ].join(' ')}
            >
              {selected && (
                <motion.span
                  layoutId={`${name}-thumb`}
                  aria-hidden="true"
                  className="segmented-switcher-thumb absolute inset-0 rounded-md bg-white shadow-sm ring-1 ring-neutral-200 dark:bg-neutral-700 dark:ring-neutral-600"
                  transition={
                    reducedMotion
                      ? { duration: 0 }
                      : { type: 'spring', stiffness: 480, damping: 38 }
                  }
                />
              )}
              <span className="segmented-switcher-text relative">{option.label}</span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
