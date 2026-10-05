/**
 * A segmented switcher: every option stays visible, and a highlight slides to
 * the selected one.
 *
 * Composed here because @mieweb/ui has no segmented control: `PillSelect` is a
 * dropdown, `ViewSwitcher` only takes its own fixed view ids, and `Tabs` has no
 * moving indicator and implies panels (searched: segment, toggle, switch, pill,
 * tabs). The options are the library's `Button`, given the radio role.
 *
 * The options always sit on one row: wrapped onto two, they stop reading as one
 * switcher. On a narrow screen they shrink and their labels truncate, so keep
 * labels short.
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
  /** Shown before the label, or in place of it with `iconOnly`. */
  icon?: React.ReactNode;
  /** Show the icon alone. The label stays as the option's accessible name and tooltip. */
  iconOnly?: boolean;
}

export interface SegmentedSwitcherProps<T extends string> {
  /** Accessible name of the group, also shown above it unless `hideLabel`. */
  label: string;
  /** Keep the label for assistive tech only, where the options explain themselves. */
  hideLabel?: boolean;
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
  hideLabel = false,
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
    <div className={`segmented-switcher ${hideLabel ? '' : 'space-y-1.5'}`}>
      <span
        id={`${name}-label`}
        className={
          hideLabel
            ? 'segmented-switcher-label sr-only'
            : 'segmented-switcher-label block text-sm font-medium text-foreground'
        }
      >
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={`${name}-label`}
        aria-disabled={disabled || undefined}
        onKeyDown={onKeyDown}
        className="segmented-switcher-track inline-flex max-w-full gap-0.5 rounded-lg bg-muted p-1 sm:gap-1"
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
              aria-label={option.iconOnly ? option.label : undefined}
              title={option.iconOnly ? option.label : undefined}
              tabIndex={selected ? 0 : -1}
              disabled={disabled}
              onClick={() => select(option.value)}
              className={[
                // `hover:bg-transparent`: the sliding highlight is the only fill.
                'segmented-switcher-option relative h-auto min-w-0 shrink rounded-md py-1.5 hover:bg-transparent dark:hover:bg-transparent',
                // An icon alone is narrower than a word, so it gets more room either side.
                option.iconOnly ? 'px-3.5 sm:px-5' : 'px-2 sm:px-3',
                selected
                  ? 'text-primary-700 dark:text-primary-300'
                  : 'text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              {selected && (
                <motion.span
                  layoutId={`${name}-thumb`}
                  aria-hidden="true"
                  className="segmented-switcher-thumb absolute inset-0 rounded-md bg-background shadow-sm ring-1 ring-border"
                  transition={
                    reducedMotion
                      ? { duration: 0 }
                      : { type: 'spring', stiffness: 480, damping: 38 }
                  }
                />
              )}
              {/* A block-level flex row one text line tall, so an icon is centred in
                  it instead of sitting on the text baseline. */}
              <span className="segmented-switcher-text relative flex min-h-5 items-center justify-center gap-1.5">
                {option.icon}
                {!option.iconOnly && option.label}
              </span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
