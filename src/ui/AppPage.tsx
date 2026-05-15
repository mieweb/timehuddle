/**
 * AppPage — Shared layout wrapper for all authenticated app route pages.
 *
 * Centralises top-level padding, spacing, max content width (md:max-w-4xl
 * centered), and page-heading structure so routes render consistently.
 *
 * Intentionally minimal: no routing, no auth, no context reads.
 */
import React from 'react';

interface AppPageProps {
  /** Optional subtitle rendered below the header area. */
  subtitle?: string;
  children: React.ReactNode;
  /**
   * When true, skip the default content max-width (full main column width).
   * Use for dense data views (e.g. tickets table, work timers).
   */
  fullWidth?: boolean;
  /**
   * Optional extra classes applied to the outer wrapper div.
   * Use sparingly — only for pages that require a non-standard layout
   * (e.g. full-height flex containers for chat/canvas interfaces).
   */
  className?: string;
}

export const AppPage: React.FC<AppPageProps> = ({ subtitle, children, className, fullWidth }) => (
  <div
    className={`w-full space-y-6 p-4 md:p-6${
      fullWidth ? '' : ' md:mx-auto md:max-w-4xl'
    }${className ? ` ${className}` : ''}`}
  >
    {subtitle && <p className="text-sm text-neutral-500 dark:text-neutral-400">{subtitle}</p>}
    {children}
  </div>
);
