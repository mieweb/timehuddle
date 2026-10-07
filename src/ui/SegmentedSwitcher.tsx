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
import { Button, Tooltip, useMediaQuery } from '@mieweb/ui';
import { motion, useReducedMotion } from 'motion/react';
import React, { useRef } from 'react';

/** Tailwind's `md`: below it there is no hover, and so no tooltip. */
const PHONE_QUERY = '(max-width: 767px)';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Shown before the label, or in place of it with `iconOnly`. */
  icon?: React.ReactNode;
  /**
   * Show the icon alone. The label stays as the option's accessible name, and
   * shows in a tooltip on a wide screen.
   */
  iconOnly?: boolean;
  /** A short extra after the label, in quieter text: a count, say. */
  detail?: React.ReactNode;
  /** What assistive tech calls the option, when the label alone is not enough. */
  accessibleName?: string;
  /**
   * The option's own text colour, where the colour carries meaning. It is kept
   * whether or not the option is selected; the one not selected is dimmed.
   */
  toneClassName?: string;
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
  /** A lower track, the height of a small `Button`, for a row it shares with some. */
  compact?: boolean;
}

export function SegmentedSwitcher<T extends string>({
  label,
  options,
  value,
  onValueChange,
  name,
  disabled = false,
  hideLabel = false,
  compact = false,
}: SegmentedSwitcherProps<T>) {
  const reducedMotion = useReducedMotion();
  const phone = useMediaQuery(PHONE_QUERY);
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
        className={`segmented-switcher-track inline-flex max-w-full gap-0.5 rounded-lg bg-muted sm:gap-1 ${compact ? 'p-0.5' : 'p-1'}`}
      >
        {options.map((option) => {
          const selected = option.value === value;
          const button = (
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
              aria-label={option.accessibleName ?? (option.iconOnly ? option.label : undefined)}
              tabIndex={selected ? 0 : -1}
              disabled={disabled}
              onClick={() => select(option.value)}
              className={[
                // `hover:bg-transparent`: the sliding highlight is the only fill.
                'segmented-switcher-option relative h-auto min-w-0 shrink rounded-md hover:bg-transparent dark:hover:bg-transparent',
                compact ? 'py-1' : 'py-1.5',
                // An icon alone is narrower than a word, so it gets more room either side.
                option.iconOnly ? 'px-3.5 sm:px-5' : 'px-2 sm:px-3',
                option.toneClassName
                  ? `${option.toneClassName} ${selected ? '' : 'opacity-60 hover:opacity-100'}`
                  : selected
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
                {option.detail != null && (
                  <span className="segmented-switcher-detail text-xs font-normal tabular-nums opacity-80">
                    {option.detail}
                  </span>
                )}
              </span>
            </Button>
          );
          // An icon alone gets its name in a tooltip, on hover and on keyboard
          // focus. Not on a phone: there is no hover there, and a tooltip that
          // opens on tap sits over the control it names.
          return option.iconOnly ? (
            <Tooltip key={option.value} content={option.label} placement="bottom" disabled={phone}>
              {button}
            </Tooltip>
          ) : (
            button
          );
        })}
      </div>
    </div>
  );
}
