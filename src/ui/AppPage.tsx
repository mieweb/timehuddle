/**
 * AppPage — Shared layout wrapper for all authenticated app route pages.
 *
 * Centralises top-level padding, spacing, and page-heading structure so that
 * every route renders consistently without per-page boilerplate.
 *
 * Intentionally minimal: no routing, no auth, no context reads.
 */
import React from 'react';

interface AppPageProps {
  /** Optional subtitle rendered below the header area. */
  subtitle?: string;
  children: React.ReactNode;
  /**
   * Optional extra classes applied to the outer wrapper div.
   * Use sparingly — only for pages that require a non-standard layout
   * (e.g. full-height flex containers for chat/canvas interfaces).
   */
  className?: string;
}

export const AppPage: React.FC<AppPageProps> = ({ subtitle, children, className }) => (
  <div className={`w-full space-y-6 p-4 md:p-6${className ? ` ${className}` : ''}`}>
    {subtitle && <p className="text-sm text-neutral-500 dark:text-neutral-400">{subtitle}</p>}
    {children}
  </div>
);
