/**
 * Timer — A flexible timer display component inspired by cult-ui/timer.
 *
 * Supports multiple variants (default, outline, ghost, success) and sizes (sm, md, lg).
 * Uses compound components for flexibility: TimerRoot, TimerIcon, TimerDisplay.
 */
import { faClock } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import React from 'react';

// ─── Variant & Size Styles ───────────────────────────────────────────────────

type TimerVariant = 'default' | 'outline' | 'ghost' | 'success';
type TimerSize = 'sm' | 'md' | 'lg';

const rootVariantClasses: Record<TimerVariant, string> = {
  default:
    'bg-white text-neutral-900 border border-neutral-200 shadow-sm dark:bg-neutral-800 dark:text-neutral-100 dark:border-neutral-700',
  outline:
    'border border-neutral-300 bg-transparent text-neutral-700 dark:border-neutral-600 dark:text-neutral-300',
  ghost: 'bg-transparent text-neutral-700 dark:text-neutral-300',
  success:
    'bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-800',
};

const rootSizeClasses: Record<TimerSize, string> = {
  sm: 'text-xs px-2 py-1 gap-1.5',
  md: 'text-sm px-2.5 py-1.5 gap-2',
  lg: 'text-base px-3 py-2 gap-2.5',
};

const iconSizeClasses: Record<TimerSize, string> = {
  sm: 'text-[10px]',
  md: 'text-xs',
  lg: 'text-sm',
};

const displaySizeClasses: Record<TimerSize, string> = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
};

// ─── TimerRoot ───────────────────────────────────────────────────────────────

export interface TimerRootProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: TimerVariant;
  size?: TimerSize;
  loading?: boolean;
}

export const TimerRoot = React.forwardRef<HTMLDivElement, TimerRootProps>(
  ({ variant = 'default', size = 'md', className = '', children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`inline-flex items-center rounded-full font-medium transition-all duration-200 ${rootVariantClasses[variant]} ${rootSizeClasses[size]} ${className}`}
        {...props}
      >
        {children}
      </div>
    );
  },
);
TimerRoot.displayName = 'TimerRoot';

// ─── TimerIcon ───────────────────────────────────────────────────────────────

export interface TimerIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: TimerSize;
  loading?: boolean;
  icon?: IconDefinition;
}

export const TimerIcon = React.forwardRef<HTMLSpanElement, TimerIconProps>(
  ({ size = 'md', loading = false, icon = faClock, className = '', ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={`flex items-center justify-center ${iconSizeClasses[size]} ${loading ? 'animate-spin' : ''} ${className}`}
        {...props}
      >
        <FontAwesomeIcon icon={icon} />
      </span>
    );
  },
);
TimerIcon.displayName = 'TimerIcon';

// ─── TimerDisplay ────────────────────────────────────────────────────────────

export interface TimerDisplayProps extends React.HTMLAttributes<HTMLSpanElement> {
  time: string;
  size?: TimerSize;
  label?: string;
}

export const TimerDisplay = React.forwardRef<HTMLSpanElement, TimerDisplayProps>(
  ({ time, size = 'md', label, className = '', ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={`font-mono tabular-nums tracking-tight ${displaySizeClasses[size]} ${className}`}
        aria-label={label}
        {...props}
      >
        {time}
      </span>
    );
  },
);
TimerDisplay.displayName = 'TimerDisplay';

// ─── Timer (Convenience Compound) ────────────────────────────────────────────

export interface TimerProps extends Omit<TimerRootProps, 'children'> {
  time: string;
  icon?: IconDefinition;
  showIcon?: boolean;
}

export const Timer = React.forwardRef<HTMLDivElement, TimerProps>(
  ({ time, icon, showIcon = true, variant, size, loading, ...props }, ref) => {
    return (
      <TimerRoot ref={ref} variant={variant} size={size} loading={loading} {...props}>
        {showIcon && <TimerIcon size={size} loading={loading} icon={icon} />}
        <TimerDisplay time={time} size={size} />
      </TimerRoot>
    );
  },
);
Timer.displayName = 'Timer';
