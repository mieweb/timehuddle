/**
 * AppPage — The standard layout every authenticated route renders inside.
 *
 * One shape for every page: a centred content column with consistent padding,
 * led by the shared <PageTitle />. Pages pick a column width; they never
 * hand-roll padding or max-widths.
 *
 *   width="content"  (default) reading and forms — dashboard, settings, teams
 *   width="wide"               data-dense grids — work, tickets, timesheet
 *   fill                       content owns the remaining height and scrolls
 *                              itself (chat, board, canvas)
 *   flush                      content runs edge-to-edge; the title keeps the
 *                              standard padding and alignment (canvases)
 *
 * The title is deliberately outside the `flush` escape hatch: a full-bleed
 * canvas should not drag the page heading to the viewport edge with it.
 */
import { cn } from '@mieweb/ui';
import React from 'react';

import { PageTitle, usePageTitle } from './pageTitle';

export type PageWidth = 'content' | 'wide';

const COLUMN: Record<PageWidth, string> = {
  content: 'max-w-4xl',
  wide: 'max-w-7xl',
};

interface AppPageProps {
  /** Content column width. Defaults to the reading-width column. */
  width?: PageWidth;
  /** Optional supporting line rendered under the page title. */
  subtitle?: string;
  /** Content fills the remaining height and manages its own scrolling. */
  fill?: boolean;
  /** Content sits flush to the edges. Only for canvases (chat, org chart). */
  flush?: boolean;
  /** Extra classes for the outer wrapper. Use sparingly. */
  className?: string;
  children: React.ReactNode;
}

export const AppPage: React.FC<AppPageProps> = ({
  width = 'content',
  subtitle,
  fill,
  flush,
  className,
  children,
}) => {
  const title = usePageTitle();
  // Profile and ticket detail have no registry title and lead with their own
  // heading — they get no header block, and no gap where one would have been.
  const hasHeader = Boolean(title || subtitle);
  const column = cn('mx-auto w-full', COLUMN[width]);

  return (
    <div className={cn('app-page flex w-full flex-col', fill && 'h-full min-h-0', className)}>
      {hasHeader && (
        <div className={cn('shrink-0 px-4 pt-4 md:px-6 md:pt-6', !flush && column)}>
          <PageTitle subtitle={subtitle} />
        </div>
      )}

      <div
        className={cn(
          'w-full space-y-6',
          hasHeader ? 'pt-6' : 'pt-4 md:pt-6',
          // A filling page's children size themselves against this column, so
          // it has to be the flex context they stretch inside.
          fill && 'flex min-h-0 flex-1 flex-col',
          !flush && cn(column, 'px-4 pb-4 md:px-6 md:pb-6'),
        )}
      >
        {children}
      </div>
    </div>
  );
};
