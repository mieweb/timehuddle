/**
 * TicketList — the unified ticket list, whatever the ticket's source.
 *
 * Purely presentational: it receives one already-filtered, already-sorted list
 * of tickets and reports per-source load failures, so a broken source cannot
 * blank out the sources that are working.
 *
 * One layout at every width: each ticket is a row carrying its properties (see
 * `RowList`). The header keeps select all and Open/Closed on the left, and the
 * sort and filter pills after them: on its one line while they fit, and in a
 * pane that opens under it when they do not (see `TicketListControls`).
 * Selection is host-owned: always offered on a wide screen, and only while
 * selecting on a phone.
 */
import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Checkbox, cn, Text, useMediaQuery } from '@mieweb/ui';
import { Clock, Pin } from 'lucide-react';
import React from 'react';

import { RowList } from '../../ui/RowList';

import { BOARD_HEADING_HEIGHT, BoardSectionHeading } from './BoardSectionHeading';
import { boardText } from './boardStrings';
import {
  arrangeFromIds,
  boardEntries,
  boardEntryId,
  canLandOn,
  PINNED_HEADING,
  splitPinned,
  type BoardCollapsed,
  type BoardEntry,
} from './boardSections';
import { TicketRow } from './TicketRow';
import { TicketOpenClosedToggle } from './TicketOpenClosedToggle';
import { TicketListControls, type TicketField } from './TicketListControls';
import { useShowHuddleIds } from './useShowHuddleIds';
import { SOURCE_LABELS, TICKET_SOURCES, type TicketSourceId, type UnifiedTicket } from './sources';
import {
  assigneeOptions,
  containerOptions,
  priorityOptions,
  statusOptions,
  ME,
  NO_PRIORITY,
  UNASSIGNED,
  type SortField,
  type SortSpec,
  type TicketFilters,
} from './ticketFilters';

const text = {
  list: (showClosed: boolean) => (showClosed ? 'Closed tickets' : 'Open tickets'),
  selectAll: 'Select all tickets',
  deselectAll: 'Deselect all tickets',
  showHuddleIds: 'Show TimeHuddle IDs',
  loading: 'Loading tickets',
  count: (count: number, showClosed: boolean) =>
    `${count} ${showClosed ? 'closed' : 'open'} ticket${count === 1 ? '' : 's'}`,
  loadError: (source: string, message: string) => `Couldn’t load ${source} tickets: ${message}`,
  loadErrors: 'Source load errors',
  myOrder: 'My order',
};

export interface TicketListProps {
  /** The rows to list, already filtered and sorted. */
  tickets: UnifiedTicket[];
  /**
   * Changes when the search, a filter, the sort or Open/Closed does. The list
   * scrolls back to its first row then: the old position means nothing in a
   * different list. New rows arriving in the same list leave it alone.
   */
  listKey: string;
  /** Everything matching the search, whatever the filters, used to build the filter menus. */
  optionSource: UnifiedTicket[];
  loading: boolean;
  errors: { sourceId: TicketSourceId; message: string }[];
  isCreator: (ticket: UnifiedTicket) => boolean;
  sort: SortSpec;
  onSortChange: (field: SortField) => void;
  filters: TicketFilters;
  onFiltersChange: (filters: TicketFilters) => void;
  onClearFilters: () => void;
  openMenuId: string | null;
  onOpenMenuChange: (menuId: string | null) => void;
  boundaryRef?: React.RefObject<HTMLElement | null>;
  selectedKeys: Set<string>;
  selecting: boolean;
  onSelectedChange: (ticket: UnifiedTicket, selected: boolean) => void;
  onSelectAllChange: (selected: boolean) => void;
  /** `${sourceId}:${id}` of the ticket whose timer is running, if any. */
  runningTicketKey: string | null;
  /** `${sourceId}:${id}` of the row whose timer is mid start/stop, if any. */
  timerLoadingKey: string | null;
  showClosed: boolean;
  onShowClosedChange: (showClosed: boolean) => void;
  openCount: number;
  closedCount: number;
  emptyState: React.ReactNode;
  onToggleTimer: (ticket: UnifiedTicket) => void;
  /** Whether a ticket is on My Board — see `TicketRow`. */
  isOnBoard: (ticket: UnifiedTicket) => boolean;
  /** The board has been read, so `isOnBoard` is a fact — see `useMyBoardKeys`. */
  boardKnown: boolean;
  /** `${sourceId}:${id}` of the row being put on or taken off the board, if any. */
  boardLoadingKey: string | null;
  onToggleBoard: (ticket: UnifiedTicket) => void;
  onEditRequest: (ticket: UnifiedTicket) => void;
  onDeleteRequest: (ticket: UnifiedTicket) => void;
  onChangeStatusRequest: (ticket: UnifiedTicket) => void;
  /**
   * Makes the list the member's to order (My Board): rows get a drag handle,
   * and a move reports the listed tickets' keys in their new order.
   */
  onReorder?: (keys: string[]) => void;
  /**
   * My Board's Pinned section. With it, the open list is two sections in one
   * sortable list (see `boardSections`), and rows offer Pin / Unpin.
   */
  pinning?: BoardPinning;
}

export interface BoardPinning {
  /** The pinned tickets' keys, in their order. */
  keys: readonly string[];
  /**
   * After a move: the pinned keys and the rest's listed order, and whether the
   * moved ticket stayed in the rest (an order change rather than a pin).
   */
  onArrange: (pinned: string[], rest: string[], reorderedRest: boolean) => void;
  onTogglePin: (ticket: UnifiedTicket) => void;
  onClockIn: () => void;
}

const ticketKey = (ticket: UnifiedTicket) => ticket.key;
const ticketTitle = (ticket: UnifiedTicket) => ticket.title;
const entryTitle = (entry: BoardEntry) => (entry.kind === 'ticket' ? entry.ticket.title : entry.id);
const isTicketEntry = (entry: BoardEntry) => entry.kind === 'ticket';

/**
 * The section headings stick while their sections scroll: Pinned's at the
 * top, Rest of My Board's under it. On the row element, picked out by the
 * heading inside it.
 */
// Rest's top is BOARD_HEADING_HEIGHT, written out: Tailwind only sees literal classes.
const STICKY_HEADINGS =
  'has-[[data-sticky=pinned]]:sticky has-[[data-sticky=pinned]]:top-0 has-[[data-sticky=pinned]]:z-[6] ' +
  'has-[[data-sticky=rest]]:sticky has-[[data-sticky=rest]]:top-[42px] has-[[data-sticky=rest]]:z-[5]';

export const TicketList: React.FC<TicketListProps> = ({
  tickets,
  listKey,
  optionSource,
  loading,
  errors,
  isCreator,
  sort,
  onSortChange,
  filters,
  onFiltersChange,
  onClearFilters,
  openMenuId,
  onOpenMenuChange,
  boundaryRef,
  selectedKeys,
  selecting,
  onSelectedChange,
  onSelectAllChange,
  runningTicketKey,
  timerLoadingKey,
  showClosed,
  onShowClosedChange,
  openCount,
  closedCount,
  emptyState,
  onToggleTimer,
  isOnBoard,
  boardKnown,
  boardLoadingKey,
  onToggleBoard,
  onEditRequest,
  onDeleteRequest,
  onChangeStatusRequest,
  onReorder,
  pinning,
}) => {
  // Both sections start open.
  const [collapsed, setCollapsed] = React.useState<BoardCollapsed>({ pinned: false, rest: false });
  // The Rest heading has scrolled up to where it sticks, under Pinned's: the
  // pinned tickets are out of sight above.
  const [pastPinned, setPastPinned] = React.useState(false);
  const restHeadingRef = React.useRef<HTMLDivElement | null>(null);
  const scrollerOf = (el: HTMLElement | null) =>
    el?.closest<HTMLElement>('.row-list-scroll') ?? null;
  const showsSections = Boolean(pinning) && !showClosed && tickets.length > 0;
  React.useEffect(() => {
    const scroller = scrollerOf(restHeadingRef.current);
    if (!showsSections || !scroller) {
      setPastPinned(false);
      return;
    }
    const check = () => {
      const row = restHeadingRef.current?.closest('li');
      if (!row) return;
      const top = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      setPastPinned(top <= BOARD_HEADING_HEIGHT + 0.5);
    };
    check();
    scroller.addEventListener('scroll', check, { passive: true });
    return () => scroller.removeEventListener('scroll', check);
  }, [showsSections, collapsed]);
  // Each mounted list needs its own switcher name: it ties the sliding highlight.
  const stateSwitcherName = `ticket-state-${React.useId()}`;
  const compact = useMediaQuery('(max-width: 767px)');
  const showSelectionControls = !compact || selecting;
  const selectedOnPage = tickets.filter((t) => selectedKeys.has(t.key)).length;
  const allSelected = tickets.length > 0 && selectedOnPage === tickets.length;
  const someSelected = selectedOnPage > 0 && !allSelected;

  const [showHuddleIds, setShowHuddleIds] = useShowHuddleIds();

  const set = <K extends keyof TicketFilters>(key: K, value: TicketFilters[K]) =>
    onFiltersChange({ ...filters, [key]: value });

  // In the order they are kept on the header's line as it narrows: the ones
  // reached for most come first. The registry drives the source options, so a
  // third source needs no change here.
  const fields: TicketField[] = [
    // A list the member orders by hand leads with that order.
    ...(onReorder ? [{ label: text.myOrder, sortField: 'manual' as const }] : []),
    {
      label: 'Assignees',
      filter: {
        anyLabel: 'Anyone',
        searchPlaceholder: 'Search people',
        options: assigneeOptions(optionSource),
        multiple: true,
        values: filters.assignees,
        onChange: (values) => set('assignees', values),
        // "Me" first: it is the shortcut people reach for most, and it spans
        // every source at once (see the ME sentinel).
        extraOptions: [
          { value: ME, label: 'Me' },
          { value: UNASSIGNED, label: 'Unassigned' },
        ],
      },
    },
    {
      label: 'Project',
      sortField: 'container',
      filter: {
        anyLabel: 'All projects',
        searchPlaceholder: 'Search projects',
        options: containerOptions(optionSource),
        multiple: true,
        values: filters.containers,
        onChange: (values) => set('containers', values),
      },
    },
    {
      label: 'Source',
      sortField: 'source',
      filter: {
        anyLabel: 'All sources',
        options: TICKET_SOURCES.map((source) => ({
          value: source.id,
          label: SOURCE_LABELS[source.id],
        })),
        // One selected source reads as "Redmine"; none selected reads as "All".
        values: filters.sources.length === 1 ? [filters.sources[0]] : [],
        onChange: (values) => set('sources', values as TicketSourceId[]),
      },
    },
    {
      label: 'Status',
      sortField: 'status',
      filter: {
        anyLabel: 'Any status',
        options: statusOptions(optionSource),
        multiple: true,
        values: filters.statuses,
        onChange: (values) => set('statuses', values),
      },
    },
    {
      label: 'Priority',
      sortField: 'priority',
      filter: {
        anyLabel: 'Any priority',
        options: priorityOptions(optionSource),
        multiple: true,
        values: filters.priorities,
        onChange: (values) => set('priorities', values),
        extraOptions: [{ value: NO_PRIORITY, label: 'No priority' }],
      },
    },
    {
      label: 'Issue #',
      sortField: 'ref',
      toggles: [{ label: text.showHuddleIds, on: showHuddleIds, onChange: setShowHuddleIds }],
    },
    { label: 'Updated', sortField: 'updated' },
    { label: 'Title', sortField: 'title' },
  ];

  const pinnedSet = new Set(pinning?.keys ?? []);
  const renderTicket = (ticket: UnifiedTicket) => (
    <TicketRow
      ticket={ticket}
      isCreator={isCreator(ticket)}
      selected={selectedKeys.has(ticket.key)}
      selecting={showSelectionControls}
      onSelectedChange={onSelectedChange}
      isTimerRunning={runningTicketKey === ticket.key}
      timerLoading={timerLoadingKey === ticket.key}
      // One timer start or stop at a time (TicketStartProvider).
      timerDisabled={timerLoadingKey !== null}
      onToggleTimer={onToggleTimer}
      onBoard={isOnBoard(ticket)}
      boardKnown={boardKnown}
      boardLoading={boardLoadingKey === ticket.key}
      onToggleBoard={onToggleBoard}
      onEditRequest={onEditRequest}
      onDeleteRequest={onDeleteRequest}
      onChangeStatusRequest={onChangeStatusRequest}
      pinned={pinnedSet.has(ticket.key)}
      onTogglePin={pinning?.onTogglePin}
    />
  );

  // My Board's open list: Pinned, then the rest, as one sortable list. Only
  // with tickets to list, so an empty board keeps its empty state.
  const sections = (() => {
    if (!pinning || !showsSections) return null;
    const { pinned, rest } = splitPinned(tickets, pinning.keys);
    const shownPinned = pinned.map((t) => t.key);
    const entries = boardEntries(pinned, rest, collapsed);
    return {
      entries,
      onReorder: (ids: string[], movedId: string) => {
        const next = arrangeFromIds(
          ids,
          pinning.keys,
          { pinned: shownPinned, rest: rest.map((t) => t.key) },
          collapsed,
        );
        const wasRest = rest.some((t) => t.key === movedId);
        pinning.onArrange(next.pinned, next.rest, wasRest && next.rest.includes(movedId));
      },
      revealPinned: () =>
        scrollerOf(restHeadingRef.current)?.scrollTo({ top: 0, behavior: 'smooth' }),
      renderEntry: (entry: BoardEntry) => {
        const pinnedScrolledPast = pastPinned && !collapsed.pinned && pinned.length > 0;
        const at = entries.indexOf(entry);
        const next = entries[at + 1];
        const content =
          entry.kind === 'ticket' ? (
            renderTicket(entry.ticket)
          ) : entry.id === PINNED_HEADING ? (
            <BoardSectionHeading
              title={boardText.pinnedHeading}
              icon={<Pin className="h-3.5 w-3.5" aria-hidden="true" />}
              count={pinned.length}
              countLabel={boardText.pinnedCount(pinned.length)}
              collapsed={collapsed.pinned}
              onCollapsedChange={(c) => setCollapsed((prev) => ({ ...prev, pinned: c }))}
              toggleLabel={collapsed.pinned ? boardText.expandPinned : boardText.collapsePinned}
              scrolledPast={
                pinnedScrolledPast
                  ? { label: boardText.revealPinned, onReveal: () => sections?.revealPinned() }
                  : undefined
              }
              action={
                pinned.length > 0 && (
                  <Button
                    variant="primary"
                    size="sm"
                    className="board-pinned-clock-in rounded-full"
                    leftIcon={<Clock className="h-3.5 w-3.5" aria-hidden="true" />}
                    aria-label={boardText.clockInLabel(pinned.length)}
                    onClick={pinning.onClockIn}
                  >
                    {boardText.clockIn}
                  </Button>
                )
              }
            />
          ) : (
            <BoardSectionHeading
              title={boardText.restHeading}
              count={rest.length}
              countLabel={boardText.restCount(rest.length)}
              collapsed={collapsed.rest}
              onCollapsedChange={(c) => setCollapsed((prev) => ({ ...prev, rest: c }))}
              toggleLabel={collapsed.rest ? boardText.expandRest : boardText.collapseRest}
            />
          );
        // Each section is a card: its heading opens it, its last entry closes
        // it. The gap before the second card is padding inside its heading's
        // row, so the rows' measured heights stay true while one is dragged.
        return (
          // A heading's row is opaque, so the rows scrolling under it while it
          // sticks don't show through: in the page's own colour (`styles.css`),
          // so the row itself doesn't show.
          <div
            ref={
              entry.kind === 'heading' && entry.id !== PINNED_HEADING ? restHeadingRef : undefined
            }
            data-sticky={
              entry.kind === 'heading'
                ? entry.id === PINNED_HEADING
                  ? 'pinned'
                  : 'rest'
                : undefined
            }
            className={cn(
              entry.kind === 'heading' && 'bg-neutral-50 dark:bg-neutral-950',
              entry.kind === 'heading' && entry.id !== PINNED_HEADING && 'pt-1.5',
            )}
          >
            <div
              className={cn(
                'board-section-part border-x border-border/50 bg-card/40',
                entry.kind === 'heading' && 'rounded-t-xl border-t',
                // Scrolled past, Pinned's heading closes its card, as if collapsed.
                (!next ||
                  next.kind === 'heading' ||
                  (entry.kind === 'heading' &&
                    entry.id === PINNED_HEADING &&
                    pinnedScrolledPast)) &&
                  'overflow-hidden rounded-b-xl border-b [&_.board-section-heading]:border-b-0 [&_.row-list-item]:border-b-0',
              )}
            >
              {content}
            </div>
          </div>
        );
      },
    };
  })();

  const header = (
    <div className="ticket-list-header-controls flex w-full min-w-0 flex-wrap items-center gap-1.5">
      <div className="ticket-list-header-primary flex shrink-0 items-center gap-2">
        {showSelectionControls && (
          <Checkbox
            size="sm"
            checked={allSelected}
            indeterminate={someSelected}
            disabled={tickets.length === 0}
            onChange={(e) => onSelectAllChange(e.target.checked)}
            aria-label={allSelected ? text.deselectAll : text.selectAll}
          />
        )}
        <TicketOpenClosedToggle
          name={stateSwitcherName}
          showClosed={showClosed}
          onShowClosedChange={onShowClosedChange}
          openCount={openCount}
          closedCount={closedCount}
          loading={loading}
        />
      </div>
      <TicketListControls
        fields={fields}
        sort={sort}
        onSortChange={onSortChange}
        onClearFilters={onClearFilters}
        openMenuId={openMenuId}
        onOpenMenuChange={onOpenMenuChange}
        boundaryRef={boundaryRef}
      />
    </div>
  );

  return (
    <>
      {errors.length > 0 && (
        <ul
          className="shrink-0 border-b border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
          aria-label={text.loadErrors}
        >
          {errors.map((error) => (
            <li key={error.sourceId} className="flex items-center gap-2 px-4 py-2">
              <FontAwesomeIcon
                icon={faTriangleExclamation}
                className="text-xs text-amber-600 dark:text-amber-500"
              />
              <Text size="xs" className="text-amber-800 dark:text-amber-300">
                {text.loadError(SOURCE_LABELS[error.sourceId], error.message)}
              </Text>
            </li>
          ))}
        </ul>
      )}

      {/* Announced to screen readers when filters change the result count. */}
      <div className="sr-only" role="status" aria-live="polite">
        {loading ? text.loading : text.count(tickets.length, showClosed)}
      </div>

      {sections ? (
        <RowList
          label={text.list(showClosed)}
          className="ticket-list"
          header={header}
          items={sections.entries}
          getId={boardEntryId}
          getTitle={entryTitle}
          loading={loading}
          scrollKey={listKey}
          emptyState={emptyState}
          onReorder={sections.onReorder}
          canDrag={isTicketEntry}
          canDropOn={canLandOn}
          itemClassName={STICKY_HEADINGS}
          renderRow={sections.renderEntry}
        />
      ) : (
        <RowList
          label={text.list(showClosed)}
          className="ticket-list"
          header={header}
          items={tickets}
          getId={ticketKey}
          getTitle={ticketTitle}
          loading={loading}
          scrollKey={listKey}
          emptyState={emptyState}
          onReorder={onReorder}
          renderRow={renderTicket}
        />
      )}
    </>
  );
};
