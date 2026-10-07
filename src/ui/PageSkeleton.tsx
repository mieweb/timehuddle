/**
 * PageSkeleton — placeholders in the shape of a view whose content is loading.
 *
 * A `Skeleton` is a content placeholder; a `Spinner` is for inline progress
 * (a button, a row). Pages compose a `LoadingRegion` from the shapes below so
 * it resembles the content that replaces it, as `TicketTable`'s `SkeletonRow`
 * and `RedmineSuggestions`' `SuggestionSkeletons` do.
 *
 * One polite live region announces the load. The placeholders are hidden from
 * assistive technology and hold nothing focusable, so a screen reader hears
 * the load once and keyboard focus never lands on one.
 */
import { Card, CardContent, Skeleton } from '@mieweb/ui';
import React from 'react';

/** Varied so rows don't look stamped. */
const LINE_WIDTHS = ['70%', '55%', '80%', '62%', '48%'];
const lineWidth = (i: number) => LINE_WIDTHS[i % LINE_WIDTHS.length];

export const LoadingRegion: React.FC<{
  /** Announced once, e.g. "Loading dashboard…". */
  label: string;
  className?: string;
  children: React.ReactNode;
}> = ({ label, className, children }) => (
  <div className={`loading-region flex flex-col gap-4 ${className ?? ''}`}>
    <span role="status" aria-live="polite" className="sr-only">
      {label}
    </span>
    <div aria-hidden="true" className="loading-region-placeholders flex flex-col gap-4">
      {children}
    </div>
  </div>
);

/** A list of rows: an avatar or icon, a line of text and a shorter one under it. */
export const SkeletonRows: React.FC<{ count: number }> = ({ count }) => (
  <div className="skeleton-rows flex flex-col divide-y divide-neutral-100 dark:divide-neutral-800/80">
    {Array.from({ length: count }, (_, i) => (
      <div key={i} className="skeleton-row flex items-center gap-3 py-3">
        <Skeleton circle width={32} height={32} className="shrink-0" />
        <div className="skeleton-row-text flex min-w-0 flex-1 flex-col gap-1.5">
          <Skeleton variant="text" width={lineWidth(i)} />
          <Skeleton variant="text" width="30%" height={10} />
        </div>
      </div>
    ))}
  </div>
);

/** A card with a heading line over a list of rows. */
export const SkeletonPanel: React.FC<{ rows: number }> = ({ rows }) => (
  <Card padding="sm">
    <CardContent className="skeleton-panel flex flex-col gap-2">
      <Skeleton variant="text" width="30%" />
      <SkeletonRows count={rows} />
    </CardContent>
  </Card>
);

/** A row of small stat cards, as at the top of the dashboard. */
export const SkeletonStatCards: React.FC<{ count: number }> = ({ count }) => (
  <div className="skeleton-stat-cards grid grid-cols-2 gap-3 md:grid-cols-4">
    {Array.from({ length: count }, (_, i) => (
      <Card key={i} padding="sm">
        <CardContent className="skeleton-stat-card flex items-start gap-3">
          <Skeleton width={36} height={36} className="shrink-0 rounded-lg" />
          <div className="skeleton-stat-card-text flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton variant="text" width="50%" height={20} />
            <Skeleton variant="text" width={lineWidth(i)} height={10} />
          </div>
        </CardContent>
      </Card>
    ))}
  </div>
);
