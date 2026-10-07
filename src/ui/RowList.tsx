/**
 * RowList — a list of rows that lays itself out by the width it is given.
 *
 * One layout at every width, mobile first. A row is a title with a line of
 * detail under it, a set of properties, and controls at either end. Narrow, the
 * properties wrap onto lines under the title; with more room they move up
 * beside it, onto fewer lines, with more space between them. Nothing is hidden
 * for lack of space and nothing scrolls sideways.
 *
 * None of that is a breakpoint. The row is a wrapping flex line — the
 * properties sit beside the title for as long as both fit, and drop under it
 * when they do not — and its spacing is in container units, so it follows the
 * list's own width: resizing the window and opening the sidebar both change it
 * smoothly, and no viewport width or media query picks a rendering.
 *
 * The rows themselves are `@mieweb/ui`'s `ListView` (the Views family), so the
 * list semantics, empty state and item styling are the library's; this adds
 * the header, the scrolling, the trailing placeholders and the row layout.
 */
import { cn, ListView, ScrollArea, Skeleton } from '@mieweb/ui';
import React from 'react';

import { MINIMAL_SCROLLBAR_CLASS } from './scrollbar';

/**
 * Inline padding and the gap between a row's parts, in container units so they
 * grow with the list's width between a phone's floor and a wide screen's cap.
 */
const SPACING_VARS =
  '[--row-list-inset:clamp(0.75rem,2.5cqi,1.5rem)] [--row-list-gap:clamp(0.5rem,1.5cqi,1rem)]';

/** Selectors for whatever in a row does its own job when clicked. */
const ROW_CONTROLS = '[data-row-list-control], button, a, input, label, [role="menu"]';

export interface RowListItemProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Controls before the content, e.g. a select checkbox and a state icon. */
  leading?: React.ReactNode;
  /** What the row is. Wraps in full rather than truncating. */
  title: React.ReactNode;
  /** A secondary line under the title. */
  meta?: React.ReactNode;
  /** Beside the title when there is room, under it when there is not. */
  properties?: React.ReactNode;
  /** Controls at the end of the row's first line, e.g. an options menu. */
  actions?: React.ReactNode;
  selected?: boolean;
  /**
   * Called on a click anywhere in the row but its controls. A pointer
   * convenience only: give the row a real control (its title, say) for the
   * keyboard. A click that ends a text selection is someone copying, not
   * opening, so it is ignored.
   */
  onOpen?: () => void;
}

export const RowListItem: React.FC<RowListItemProps> = ({
  leading,
  title,
  meta,
  properties,
  actions,
  selected = false,
  onOpen,
  className,
  ...rest
}) => {
  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    rest.onClick?.(event);
    if (!onOpen || event.defaultPrevented) return;
    // Portaled menus are outside the row's DOM, but their clicks still bubble
    // here through React, so `closest` covers them too.
    if ((event.target as HTMLElement).closest(ROW_CONTROLS)) return;
    if (window.getSelection()?.toString()) return;
    onOpen();
  };

  return (
    <div
      {...rest}
      data-selected={selected || undefined}
      onClick={handleClick}
      className={cn(
        'row-list-item flex w-full min-w-0 items-start gap-x-(--row-list-gap) px-(--row-list-inset) py-1.5 transition-colors',
        onOpen && 'cursor-pointer hover:bg-muted/60',
        selected && 'bg-primary-500/10 hover:bg-primary-500/15',
        className,
      )}
    >
      {/* Every part's first line is h-8, so controls line up with the title's first line. */}
      {leading && (
        <div
          className="row-list-leading flex h-8 shrink-0 items-center gap-2"
          data-row-list-control
        >
          {leading}
        </div>
      )}
      <div className="row-list-content flex min-w-0 flex-1 flex-wrap items-start gap-x-(--row-list-gap)">
        <div className="row-list-main min-w-0 flex-[1_1_18rem]">
          <div className="row-list-title py-1.5 text-sm leading-5 break-words">{title}</div>
          {meta && (
            <div className="row-list-meta flex min-w-0 flex-wrap items-center gap-x-1.5 pb-1 text-xs text-muted-foreground">
              {meta}
            </div>
          )}
        </div>
        {properties && (
          <div className="row-list-properties flex min-h-8 min-w-0 flex-wrap content-center items-center gap-x-[clamp(0.375rem,1cqi,0.75rem)] gap-y-1.5 py-1.5">
            {properties}
          </div>
        )}
      </div>
      {actions && (
        <div className="row-list-actions flex h-8 shrink-0 items-center" data-row-list-control>
          {actions}
        </div>
      )}
    </div>
  );
};

/** A placeholder shaped like a row: a control, a title, a detail line and two properties. */
export const RowListSkeleton: React.FC = () => (
  <RowListItem
    aria-hidden="true"
    className="row-list-skeleton"
    leading={<Skeleton width={16} height={16} />}
    title={<Skeleton variant="text" width="60%" />}
    meta={<Skeleton variant="text" width="30%" />}
    properties={
      <>
        <Skeleton width={56} height={20} />
        <Skeleton width={72} height={20} />
      </>
    }
  />
);

export interface RowListProps<T> {
  /** Accessible name of the list, e.g. "Open tickets". */
  label: string;
  items: T[];
  getId: (item: T) => string;
  getTitle: (item: T) => string;
  /** Render one item, usually as a `RowListItem`. */
  renderRow: (item: T) => React.ReactNode;
  /** Controls above the rows. Stays put while the rows scroll. */
  header?: React.ReactNode;
  /** Shown in place of the rows when there are none and nothing is loading. */
  emptyState?: React.ReactNode;
  /**
   * More rows may be on the way: placeholders sit under the loaded ones, so a
   * slow source never looks like "no more".
   */
  loading?: boolean;
  /** Scrolls back to the first row whenever this changes. */
  scrollKey?: unknown;
  className?: string;
}

const SKELETON_ROWS_EMPTY = 5;
const SKELETON_ROWS_TRAILING = 3;

const SCROLL_AREA_CLASS = `row-list-scroll min-h-0 w-full flex-1 [&::-webkit-scrollbar]:w-1.5 ${MINIMAL_SCROLLBAR_CLASS}`;

export function RowList<T>({
  label,
  items,
  getId,
  getTitle,
  renderRow,
  header,
  emptyState,
  loading = false,
  scrollKey,
  className,
}: RowListProps<T>) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [scrollKey]);

  const accessors = React.useMemo(() => ({ getId, getTitle }), [getId, getTitle]);
  const placeholders = loading ? (items.length ? SKELETON_ROWS_TRAILING : SKELETON_ROWS_EMPTY) : 0;

  return (
    <div
      className={cn('row-list @container flex min-h-0 flex-1 flex-col', SPACING_VARS, className)}
    >
      {header && (
        <div className="row-list-header flex shrink-0 flex-wrap items-center gap-x-(--row-list-gap) gap-y-2 border-b border-border bg-muted/40 px-(--row-list-inset) py-2">
          {header}
        </div>
      )}
      <ScrollArea
        ref={scrollRef}
        role="region"
        aria-label={label}
        orientation="vertical"
        className={SCROLL_AREA_CLASS}
      >
        {/* While nothing has loaded yet, placeholders stand in for the empty state. */}
        {!(loading && items.length === 0) && (
          <ListView
            items={items}
            accessors={accessors}
            renderItem={renderRow}
            emptyState={emptyState}
            className="overflow-visible rounded-none border-0 bg-transparent"
            classNames={{ item: 'gap-0 p-0' }}
          />
        )}
        {placeholders > 0 && (
          <div className="row-list-placeholders" aria-hidden="true">
            {Array.from({ length: placeholders }, (_, i) => (
              <div key={i} className="border-b border-border last:border-b-0">
                <RowListSkeleton />
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
