/**
 * RowList — a list of rows that lays itself out by the width it is given.
 *
 * One layout at every width, mobile first. A row is a line of detail, then
 * the title with the row's properties beside it, with controls at either end.
 * They sit the same way on a phone and on a wide monitor; a narrow row only
 * wraps them onto more lines. Nothing is hidden for lack of space and
 * nothing scrolls sideways.
 *
 * None of that is a breakpoint. The spacing is in container units, so it
 * follows the list's own width: resizing the window and opening the sidebar
 * both change it smoothly, and no viewport width or media query picks a
 * rendering.
 *
 * The rows themselves are `@mieweb/ui`'s `ListView` (the Views family), so the
 * list semantics, empty state and item styling are the library's; this adds
 * the header, the scrolling, the trailing placeholders and the row layout.
 */
import {
  Badge,
  Button,
  cn,
  ListView,
  ReorderableList,
  ScrollArea,
  Skeleton,
  Text,
} from '@mieweb/ui';
import { ChevronDown } from 'lucide-react';
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
  /** A secondary line above the title: where the item sits, its reference. */
  meta?: React.ReactNode;
  /** Beside the title, wrapping under it when the row is narrow: badges and the like. */
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
        // Ruled off from the next row: the list has no frame to hold rows together.
        'row-list-item flex w-full min-w-0 items-start gap-x-(--row-list-gap) border-b border-border px-(--row-list-inset) py-2.5 transition-colors',
        onOpen && 'cursor-pointer hover:bg-muted/60',
        selected && 'bg-primary-500/10 hover:bg-primary-500/15',
        className,
      )}
    >
      {/* Every part's first line is h-8, so the controls line up with the detail line. */}
      {leading && (
        <div
          className="row-list-leading flex h-8 shrink-0 items-center gap-2"
          data-row-list-control
        >
          {leading}
        </div>
      )}
      <div className="row-list-content min-w-0 flex-1">
        {meta && (
          <div className="row-list-meta flex min-h-8 min-w-0 flex-wrap items-center gap-x-2.5 text-sm text-muted-foreground">
            {meta}
          </div>
        )}
        {/* The properties follow the title on its line, and drop under it a
            piece at a time as the row narrows; a title too long for one line
            takes the whole width and they start on the next. */}
        <div className="row-list-title-line flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 pb-1">
          <div className="row-list-title min-w-0 text-sm leading-snug break-words">{title}</div>
          {properties && <div className="row-list-properties contents">{properties}</div>}
        </div>
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
    leading={<Skeleton variant="avatar" width={32} height={32} />}
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

/** A titled run of rows that can be folded away, e.g. My Board's Pinned. */
export interface RowListSection<T> {
  /** Stable across renders; also keys the folded state kept for this viewer. */
  id: string;
  label: string;
  items: T[];
  /** Shown in the section when it has no rows. Without it, an empty section is left out. */
  emptyText?: string;
  /**
   * The section keeps the list's sort, so a drag only moves rows into or out
   * of it: a row moved within it goes back to its place.
   */
  sorted?: boolean;
}

/** A section's rows by id, in order, as a drag left them. */
export interface RowListSectionOrder {
  id: string;
  ids: string[];
}

/** User-facing copy, kept together for translation. */
export const ROW_LIST_TEXT = {
  fold: (label: string) => `Fold ${label}`,
  unfold: (label: string) => `Unfold ${label}`,
  moved: (section: string, position: number, total: number) =>
    `${section}, position ${position} of ${total}`,
  movedInto: (section: string) => `Moved to ${section}`,
  goTo: (label: string) => `Go to ${label}`,
};

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
  /**
   * Show the rows in these sections instead of as one run. `items` is still
   * every row: it decides between the rows and the empty state.
   */
  sections?: RowListSection<T>[];
  /**
   * Lets the rows be dragged (or moved with Alt+↑/↓) within and between the
   * sections, each heading staying put; called with every section's new
   * order. Nothing goes above the first heading.
   */
  onSectionsReorder?: (order: RowListSectionOrder[]) => void;
  className?: string;
}

const SKELETON_ROWS_EMPTY = 5;
const SKELETON_ROWS_TRAILING = 3;

const SCROLL_AREA_CLASS = `row-list-scroll min-h-0 w-full flex-1 [&::-webkit-scrollbar]:w-1.5 ${MINIMAL_SCROLLBAR_CLASS}`;

const LIST_VIEW_CLASS = 'overflow-visible rounded-none border-0 bg-transparent';
const LIST_VIEW_CLASSNAMES = { item: 'gap-0 p-0' };

const FOLDED_KEY = (id: string) => `row-list-section-folded:${id}`;

function readFolded(id: string): boolean {
  try {
    return localStorage.getItem(FOLDED_KEY(id)) === '1';
  } catch {
    return false;
  }
}

function writeFolded(id: string, folded: boolean) {
  try {
    if (folded) localStorage.setItem(FOLDED_KEY(id), '1');
    else localStorage.removeItem(FOLDED_KEY(id));
  } catch {
    // Not remembered in this browser; the section still folds.
  }
}

/** Which sections are folded, remembered per viewer in this browser. */
function useFoldedSections(ids: string[]) {
  const [folded, setFolded] = React.useState(() => new Set(ids.filter(readFolded)));
  const toggle = React.useCallback((id: string) => {
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeFolded(id, next.has(id));
      return next;
    });
  }, []);
  return { folded, toggle };
}

/** `last` marks what closes its section's card: its last row, or a heading with none shown. */
type SectionEntry<T> =
  | { kind: 'heading'; id: string; section: RowListSection<T>; last: boolean }
  | { kind: 'empty'; id: string; text: string; last: boolean }
  | { kind: 'row'; id: string; item: T; last: boolean };

/**
 * Each section reads as a card: its heading opens it and its last row closes
 * it. The rows are list items of their own, so each one draws its part of the
 * card, with a soft fill and outline so the rows stay the loudest thing.
 */
const CARD_PART = 'row-list-card-part border-x border-border/50 bg-muted/20';
const CARD_TOP = 'rounded-t-xl border-t';
const CARD_BOTTOM = 'overflow-hidden rounded-b-xl border-b [&_.row-list-item]:border-b-0';
/** Rows within a card are ruled off more quietly than a plain list's. */
const CARD_ROW = '[&_.row-list-item]:border-border/40';

const headingId = (sectionId: string) => `row-list-section:${sectionId}`;
const emptyId = (sectionId: string) => `row-list-section-empty:${sectionId}`;

/**
 * The row that moved between two orders of the same ids, or null. Headings
 * never move, so when a row swapped with a heading the row is the one.
 */
function movedId(before: string[], after: string[], isHeading: (id: string) => boolean) {
  let lo = 0;
  while (lo < before.length && before[lo] === after[lo]) lo++;
  if (lo === before.length) return null;
  const rows = [before[lo], after[lo]].filter((id) => !isHeading(id));
  if (rows.length === 1) return rows[0];
  return before[lo] === after[lo + 1] ? after[lo] : before[lo];
}

/** The nearest ancestor that scrolls vertically, or null for the page. */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement; node; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
  }
  return null;
}

type Stuck = 'top' | 'bottom' | null;

/**
 * Where a sticky heading is riding its scroller: at the top once its section
 * has scrolled up under it, at the bottom while its section is still below,
 * or null in its own place. `jump` scrolls its section into view.
 */
function useStuckEdge(ref: React.RefObject<HTMLElement | null>) {
  const [stuck, setStuck] = React.useState<Stuck>(null);
  /**
   * Where the heading would sit if it didn't stick: after the last row before
   * it, plus any headings in between (an empty section's), which stick too
   * and so can't be measured from where they are.
   */
  const naturalTop = React.useCallback((item: Element) => {
    const marginTop = (el: Element) => parseFloat(getComputedStyle(el).marginTop) || 0;
    let top = marginTop(item);
    let prev = item.previousElementSibling;
    while (prev?.querySelector('.row-list-section-heading')) {
      top += prev.getBoundingClientRect().height + marginTop(prev);
      prev = prev.previousElementSibling;
    }
    const base = prev
      ? prev.getBoundingClientRect().bottom
      : item.parentElement!.getBoundingClientRect().top;
    return base + top;
  }, []);

  React.useEffect(() => {
    const heading = ref.current;
    const item = heading?.closest('[data-slot="reorderable-list-item"]');
    const scroller = scrollParent(heading);
    if (!heading || !item || !scroller) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const offset = item.getBoundingClientRect().top - naturalTop(item);
      setStuck(offset > 1 ? 'top' : offset < -1 ? 'bottom' : null);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    scroller.addEventListener('scroll', schedule, { passive: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(scroller);
    resize.observe(item.parentElement!);
    return () => {
      scroller.removeEventListener('scroll', schedule);
      resize.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [ref, naturalTop]);

  const jump = React.useCallback(() => {
    const item = ref.current?.closest('[data-slot="reorderable-list-item"]');
    const scroller = scrollParent(ref.current);
    if (!item || !scroller) return;
    const by = naturalTop(item) - scroller.getBoundingClientRect().top;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scroller.scrollBy({ top: by, behavior: smooth ? 'smooth' : 'auto' });
  }, [ref, naturalTop]);

  return { stuck, jump };
}

/** A section's heading: folds it, and says how many rows it has. */
function SectionHeading<T>({
  section,
  folded,
  onToggle,
}: {
  section: RowListSection<T>;
  folded: boolean;
  onToggle: () => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const { stuck, jump } = useStuckEdge(ref);
  return (
    <div ref={ref} className="row-list-section-heading" data-stuck={stuck ?? undefined}>
      <Button
        variant="ghost"
        // Stuck to an edge, it takes you to its section; in place, it folds it.
        aria-expanded={stuck ? undefined : !folded}
        aria-label={
          stuck
            ? ROW_LIST_TEXT.goTo(section.label)
            : folded
              ? ROW_LIST_TEXT.unfold(section.label)
              : ROW_LIST_TEXT.fold(section.label)
        }
        onClick={stuck ? jump : onToggle}
        // A plain tap: none of Button's press-down shrink or fill.
        className={cn(
          'row-list-section-trigger h-auto w-full justify-start gap-2 rounded-none px-(--row-list-inset) text-start text-xs font-semibold tracking-wide text-muted-foreground uppercase transition-[color,padding] duration-200 hover:bg-transparent hover:text-foreground active:scale-100 active:bg-transparent motion-reduce:transition-none dark:hover:bg-transparent dark:active:bg-transparent',
          // Slimmer while it rides the top of the list, full size back in place;
          // its item gains the difference as margin (mb-2), so nothing below moves.
          // Only at the top: at the bottom, a slimmer heading shortens the list
          // under it, which would move it out of the place it's stuck in.
          stuck === 'top' ? 'py-1.5' : 'py-2.5',
        )}
      >
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 transition-transform',
            folded && '-rotate-90 rtl:rotate-90',
          )}
          aria-hidden="true"
        />
        <span className="row-list-section-label">{section.label}</span>
        <Badge variant="secondary" size="sm">
          {section.items.length}
        </Badge>
      </Button>
    </div>
  );
}

interface RowListSectionsProps<T> {
  label: string;
  sections: RowListSection<T>[];
  getId: (item: T) => string;
  renderRow: (item: T) => React.ReactNode;
  onSectionsReorder?: (order: RowListSectionOrder[]) => void;
}

/**
 * The sections as one list: each heading is a row that stays put, so a row
 * dragged past one changes section. A folded section's rows are left out of
 * the list and keep their place behind its heading.
 */
function RowListSections<T>({
  label,
  sections,
  getId,
  renderRow,
  onSectionsReorder,
}: RowListSectionsProps<T>) {
  const { folded, toggle } = useFoldedSections(sections.map((s) => s.id));
  const [announcement, setAnnouncement] = React.useState('');
  const shown = onSectionsReorder
    ? sections
    : sections.filter((section) => section.items.length > 0 || section.emptyText);

  const entries = React.useMemo<SectionEntry<T>[]>(
    () =>
      shown.flatMap((section): SectionEntry<T>[] => {
        const isFolded = folded.has(section.id);
        const rows = isFolded ? [] : section.items;
        // An empty section's hint sits under its heading, which sticks without it.
        const hint = !isFolded && !rows.length && section.emptyText;
        return [
          {
            kind: 'heading' as const,
            id: headingId(section.id),
            section,
            last: !rows.length && !hint,
          },
          ...(hint
            ? [{ kind: 'empty' as const, id: emptyId(section.id), text: hint, last: true }]
            : []),
          ...rows.map((item, index) => ({
            kind: 'row' as const,
            id: getId(item),
            item,
            last: index === rows.length - 1,
          })),
        ];
      }),
    [shown, folded, getId],
  );

  // Headings and empty-section hints stay put; only rows move.
  const fixedIds = new Set(entries.filter((e) => e.kind !== 'row').map((e) => e.id));

  const handleReorder = (ids: string[]) => {
    if (!onSectionsReorder) return;
    const order: RowListSectionOrder[] = [];
    for (const id of ids) {
      const section = shown.find((s) => headingId(s.id) === id);
      if (section) order.push({ id: section.id, ids: [] });
      else if (!fixedIds.has(id)) order[order.length - 1]?.ids.push(id);
    }
    // A folded section keeps its hidden rows after any dropped onto it.
    for (const part of order) {
      if (!folded.has(part.id)) continue;
      const section = shown.find((s) => s.id === part.id)!;
      part.ids.push(...section.items.map(getId));
    }
    const moved = movedId(
      entries.map((e) => e.id),
      ids,
      (id) => fixedIds.has(id),
    );
    if (!moved) return;
    const from = shown.find((s) => s.items.some((item) => getId(item) === moved));
    const landed = order.find((part) => part.ids.includes(moved));
    const into = shown.find((s) => s.id === landed?.id);
    if (!landed || !into) return;
    if (into.sorted) {
      // Rows in a sorted section have no order of their own to change.
      if (into === from) return;
      setAnnouncement(ROW_LIST_TEXT.movedInto(into.label));
    } else {
      setAnnouncement(
        ROW_LIST_TEXT.moved(into.label, landed.ids.indexOf(moved) + 1, landed.ids.length),
      );
    }
    onSectionsReorder(order);
  };

  // A drag ends with a click on the row under the pointer; it isn't one.
  const pressedAt = React.useRef<{ x: number; y: number } | null>(null);
  const firstHeading = entries[0]?.id;

  return (
    <div
      className="row-list-sections"
      onPointerDownCapture={(e) => {
        pressedAt.current = { x: e.clientX, y: e.clientY };
      }}
      onClickCapture={(e) => {
        const from = pressedAt.current;
        if (from && Math.hypot(e.clientX - from.x, e.clientY - from.y) > 5) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <ReorderableList
        aria-label={label}
        items={entries}
        getId={(entry) => entry.id}
        canDrag={(entry) => entry.kind === 'row'}
        canDropOn={(_, target) => target !== firstHeading}
        onReorder={onSectionsReorder ? handleReorder : undefined}
        // Moves are announced below by section, not by place in the whole list.
        labels={{ moved: () => '' }}
        className="row-list-section-list"
        // The gap between cards; a heading is the first thing in each.
        classNames={{
          // Each heading sticks to the top while its section scrolls under
          // it; the next one slides over it. Opaque, so rows don't show through.
          item: '[&:has(.row-list-section-heading)]:sticky [&:has(.row-list-section-heading)]:top-0 [&:has(.row-list-section-heading)]:bottom-0 [&:has(.row-list-section-heading)]:z-[5] [&:has(.row-list-section-heading)]:bg-background [&:not(:first-child):has(.row-list-section-heading)]:mt-3 [&:has([data-stuck=top])]:mb-2',
        }}
        renderItem={(entry) => (
          <div
            className={cn(
              CARD_PART,
              entry.kind === 'heading' ? CARD_TOP : CARD_ROW,
              // Ruled off from its rows; an empty section's hint reads as part of it.
              entry.kind === 'heading' &&
                !entry.last &&
                entry.section.items.length > 0 &&
                'border-b border-b-border/40',
              entry.last && CARD_BOTTOM,
            )}
          >
            {entry.kind === 'heading' ? (
              <SectionHeading
                section={entry.section}
                folded={folded.has(entry.section.id)}
                onToggle={() => toggle(entry.section.id)}
              />
            ) : entry.kind === 'empty' ? (
              <Text
                size="sm"
                variant="muted"
                className="row-list-section-empty px-(--row-list-inset) pb-3"
              >
                {entry.text}
              </Text>
            ) : (
              renderRow(entry.item)
            )}
          </div>
        )}
      />
      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>
    </div>
  );
}

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
  sections,
  onSectionsReorder,
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
        // A rounded panel the list's full width. Its sides are padded by the
        // rows' own inset, so its first and last controls line up with theirs.
        // Its corner is the vertical padding out from a pill-shaped control's
        // own (h-7), so one line of controls reads as a pill.
        <div className="row-list-header mb-1 flex shrink-0 flex-wrap items-center gap-1.5 rounded-[1.375rem] bg-muted px-(--row-list-inset) py-2">
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
        {!(loading && items.length === 0) &&
          (sections && items.length > 0 ? (
            <RowListSections
              label={label}
              sections={sections}
              getId={getId}
              renderRow={renderRow}
              onSectionsReorder={onSectionsReorder}
            />
          ) : (
            <ListView
              items={items}
              accessors={accessors}
              renderItem={renderRow}
              emptyState={emptyState}
              className={LIST_VIEW_CLASS}
              classNames={LIST_VIEW_CLASSNAMES}
            />
          ))}
        {placeholders > 0 && (
          <div className="row-list-placeholders" aria-hidden="true">
            {Array.from({ length: placeholders }, (_, i) => (
              <RowListSkeleton key={i} />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
