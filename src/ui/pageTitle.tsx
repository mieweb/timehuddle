/**
 * pageTitle — The current page's name, rendered at the top of the body.
 *
 * Extracted into its own module so any component can consume the context
 * without creating circular dependencies with AppLayout (same reason as
 * router.ts).
 *
 * AppLayout is the single source of truth: it supplies the title straight
 * from its ROUTES registry, so pages never restate their own name and the
 * title follows automatically when a route is renamed. AppPage renders
 * <PageTitle /> for every page, so pages opt in simply by using AppPage.
 */
import { Text } from '@mieweb/ui';
import React, { createContext, useContext } from 'react';

/**
 * Null on routes with no registry title — profile and ticket detail render
 * their own, more specific heading (the person's name, the ticket's title).
 */
export const PageTitleContext = createContext<string | null>(null);

export const usePageTitle = () => useContext(PageTitleContext);

interface PageTitleProps {
  /** Optional supporting line rendered under the title. */
  subtitle?: string;
  /** Extra classes for pages with a non-standard header (e.g. Huddle's rail). */
  className?: string;
}

export const PageTitle: React.FC<PageTitleProps> = ({ subtitle, className }) => {
  const title = usePageTitle();

  if (!title && !subtitle) return null;

  return (
    <div className={`page-title min-w-0${className ? ` ${className}` : ''}`}>
      {title && (
        <Text as="h1" size="2xl" weight="semibold" className="truncate tracking-tight">
          {title}
        </Text>
      )}
      {subtitle && (
        <Text variant="muted" size="sm" className="mt-1">
          {subtitle}
        </Text>
      )}
    </div>
  );
};
