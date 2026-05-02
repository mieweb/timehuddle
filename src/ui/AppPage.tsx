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
  /** Primary page heading rendered as an accessible <h1>. */
  title: string;
  /** Optional subtitle rendered below the heading. */
  subtitle?: string;
  children: React.ReactNode;
  /**
   * Optional extra classes applied to the outer wrapper div.
   * Use sparingly — only for pages that require a non-standard layout
   * (e.g. full-height flex containers for chat/canvas interfaces).
   */
  className?: string;
}

export const AppPage: React.FC<AppPageProps> = ({ title, subtitle, children, className }) => (
  <div className={`w-full space-y-6 p-4 md:p-6${className ? ` ${className}` : ''}`}>
    <div>
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{title}</h1>
      {subtitle && (
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{subtitle}</p>
      )}
    </div>
    {children}
  </div>
);
