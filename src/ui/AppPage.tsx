/**
 * AppPage — Shared layout wrapper for all authenticated app route pages.
 *
 * Centralises top-level padding, spacing, max content width (md:max-w-4xl
 * centered), and page-heading structure so routes render consistently.
 *
 * Renders <PageTitle /> so every page leads with its name without restating
 * it — the name comes from AppLayout's ROUTES registry.
 */
import React from 'react';

import { PageTitle } from './pageTitle';

interface AppPageProps {
  /** Optional subtitle rendered below the page title. */
  subtitle?: string;
  children: React.ReactNode;
  /**
   * When true, skip the default content max-width (full main column width).
   * Use for dense data views (e.g. tickets table, work timers).
   */
  fullWidth?: boolean;
  /**
   * When true, remove the default page padding.
   * Use for full-bleed pages where content should touch container edges.
   */
  noPadding?: boolean;
  /**
   * Optional extra classes applied to the outer wrapper div.
   * Use sparingly — only for pages that require a non-standard layout
   * (e.g. full-height flex containers for chat/canvas interfaces).
   */
  className?: string;
}

export const AppPage: React.FC<AppPageProps> = ({
  subtitle,
  children,
  className,
  fullWidth,
  noPadding,
}) => (
  <div
    className={`w-full space-y-6 ${noPadding ? 'p-0 md:p-0' : 'p-4 md:p-6'}${
      fullWidth ? '' : ' md:mx-auto md:max-w-4xl'
    }${className ? ` ${className}` : ''}`}
  >
    <PageTitle subtitle={subtitle} />
    {children}
  </div>
);
