/**
 * TicketTable — the unified ticket table, whatever the ticket's source.
 *
 * Purely presentational: it receives one already-filtered, already-sorted page
 * of tickets and reports per-source load failures, so a broken source cannot
 * blank out the sources that are working.
 *
 * Sorting and filtering both live in the column headers; selection is
 * host-owned, as the library intends.
 */
import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Checkbox,
  ScrollArea,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
  useMediaQuery,
} from '@mieweb/ui';
import React from 'react';

import { MINIMAL_SCROLLBAR_CLASS } from '../../ui/scrollbar';

import { boardText } from './boardStrings';
import { TicketColumnHeader, type TicketColumnFilter } from './TicketColumnHeader';
import { TicketOpenClosedToggle } from './TicketOpenClosedToggle';
import { TicketSortFilterMenu, type TicketColumn } from './TicketSortFilterMenu';
import { TicketTableRow } from './TicketTableRow';
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

const TITLE_COLUMN: TicketColumn = { label: 'Title', sortField: 'title' };

/** Column count including select, the board and timer buttons, and actions. */
const COLUMN_COUNT = 11;
/** The compact (phone) table: the board and timer buttons, the ticket and its actions (select is extra). */
const COMPACT_COLUMN_COUNT = 3;
/**
 * Below this the table is compact: each row carries its facts under the title
 * and nothing scrolls sideways. Tailwind's `md`, where the page's own padding
 * and the table card's frame change too.
 */
export const COMPACT_QUERY = '(max-width: 767px)';

/**
 * Fixed pixel width per column (Title excepted, which flexes to fill the
 * remainder). Paired with `table-fixed` so widths come only from here and
 * never from row content — without this, a longer badge or name on one page
 * resizes every column, which is the jump this fixes.
 */
const COLUMN_WIDTH = {
  select: 44,
  ref: 90,
  source: 130,
  status: 140,
  priority: 130,
  assignees: 140,
  container: 170,
  updated: 120,
  actions: 56,
};

/**
 * The board and timer buttons' column. Off the board a row's timer button
 * reads "Add & Start", so All Sources leaves room for the words; every My
 * Board row is on the board, and a phone row stacks the two as icons.
 */
const QUICK_ACTIONS_WIDTH = { board: 92, all: 176, compact: 48 };

/** Sum of the fixed columns plus a readable floor for the flexible Title column. */
const FIXED_COLUMN_WIDTH = Object.values(COLUMN_WIDTH).reduce((sum, w) => sum + w, 0);
const TABLE_MIN_WIDTH = FIXED_COLUMN_WIDTH + 220;

// The table's scroller: rows scroll under the fixed header, columns sideways,
// both with the app's minimal thin scrollbar.
const SCROLL_AREA_CLASS = `ticket-table-scroll min-h-0 w-full flex-1 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar]:w-1.5 ${MINIMAL_SCROLLBAR_CLASS}`;

export interface TicketTableProps {
  /** The rows to list, already filtered and sorted. */
  tickets: UnifiedTicket[];
  /**
   * Changes when the search, a filter, the sort or Open/Closed does. The table
   * scrolls back to its first row then: the old position means nothing in a
   * different list. New rows arriving in the same list leave it alone.
   */
  listKey: string;
  /** Everything matching the search, used to build the filter menus. */
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
  onSelectedChange: (ticket: UnifiedTicket, selected: boolean) => void;
  onSelectAllChange: (selected: boolean) => void;
  /** `${sourceId}:${id}` of the ticket whose timer is running, if any. */
  runningTicketKey: string | null;
  /** `${sourceId}:${id}` of the row whose timer is mid start/stop, if any. */
  timerLoadingKey: string | null;
  /** Total across all pages, for the screen-reader status line. */
  totalCount: number;
  showClosed: boolean;
  onShowClosedChange: (showClosed: boolean) => void;
  /** How many open and closed tickets the view has, after its search and filters. */
  openCount: number;
  closedCount: number;
  /**
   * Compact (phone) table only: show the select column. A phone row has no
   * checkbox until the page's Select button asks for one; a wide table always
   * has the column.
   */
  selecting?: boolean;
  emptyState: React.ReactNode;
  onToggleTimer: (ticket: UnifiedTicket) => void;
  /** Whether a ticket is on My Board — see `TicketTableRow`. */
  isOnBoard: (ticket: UnifiedTicket) => boolean;
  /** `${sourceId}:${id}` of the row being put on or taken off the board, if any. */
  boardLoadingKey: string | null;
  onToggleBoard: (ticket: UnifiedTicket) => void;
  /** This table is My Board, where every row is on the board. */
  boardView?: boolean;
  onEditRequest: (ticket: UnifiedTicket) => void;
  onDeleteRequest: (ticket: UnifiedTicket) => void;
  onChangeStatusRequest: (ticket: UnifiedTicket) => void;
}

/** How many placeholder rows sit under the loaded ones while a source is still loading. */
const SKELETON_ROWS_EMPTY = 5;
const SKELETON_ROWS_TRAILING = 3;

/**
 * A placeholder row shaped like a real one: a checkbox (when the table has a
 * select column), a long title, and a short bar per remaining column. The
 * title is the one column that flexes.
 */
const SkeletonRow: React.FC<{ columnCount: number; titleIndex: number; hasSelect: boolean }> = ({
  columnCount,
  titleIndex,
  hasSelect,
}) => (
  <TableRow aria-hidden="true" className="ticket-skeleton-row">
    {Array.from({ length: columnCount }, (_, i) => (
      <TableCell key={i} className={i === 0 ? 'pl-4' : i === columnCount - 1 ? 'pr-4' : undefined}>
        {hasSelect && i === 0 ? (
          <Skeleton width={16} height={16} />
        ) : (
          <Skeleton variant="text" width={i === titleIndex ? '70%' : '60%'} />
        )}
      </TableCell>
    ))}
  </TableRow>
);

export const TicketTable: React.FC<TicketTableProps> = ({
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
  onSelectedChange,
  onSelectAllChange,
  runningTicketKey,
  timerLoadingKey,
  totalCount,
  showClosed,
  openCount,
  closedCount,
  onShowClosedChange,
  selecting = false,
  emptyState,
  onToggleTimer,
  isOnBoard,
  boardLoadingKey,
  onToggleBoard,
  boardView = false,
  onEditRequest,
  onDeleteRequest,
  onChangeStatusRequest,
}) => {
  const selectedOnPage = tickets.filter((t) => selectedKeys.has(t.key)).length;
  const allSelected = tickets.length > 0 && selectedOnPage === tickets.length;
  const someSelected = selectedOnPage > 0 && !allSelected;
  const compact = useMediaQuery(COMPACT_QUERY);
  const showSelectColumn = !compact || selecting;
  const columnCount = compact ? COMPACT_COLUMN_COUNT + (showSelectColumn ? 1 : 0) : COLUMN_COUNT;
  const quickActionsWidth = compact
    ? QUICK_ACTIONS_WIDTH.compact
    : boardView
      ? QUICK_ACTIONS_WIDTH.board
      : QUICK_ACTIONS_WIDTH.all;
  // A compact table fits the screen; a full one keeps a readable floor and scrolls.
  const tableMinWidth = compact ? undefined : TABLE_MIN_WIDTH + quickActionsWidth;

  const set = <K extends keyof TicketFilters>(key: K, value: TicketFilters[K]) =>
    onFiltersChange({ ...filters, [key]: value });

  // The registry drives the options, so a third source needs no change here.
  // One selected source reads as "Redmine"; none selected reads as "All".
  const sourceFilter: TicketColumnFilter = {
    id: 'source',
    anyLabel: 'All sources',
    options: TICKET_SOURCES.map((source) => ({
      value: source.id,
      label: SOURCE_LABELS[source.id],
    })),
    value: filters.sources.length === 1 ? filters.sources[0] : null,
    onChange: (value) => set('sources', value ? [value as TicketSourceId] : []),
  };

  const headerProps = { sort, onSortChange, openMenuId, onOpenMenuChange, boundaryRef };

  // The columns after Title, defined once: a header each on a wide screen, and
  // one menu between them on a phone.
  const columns: TicketColumn[] = [
    { label: 'Issue #', sortField: 'ref' },
    { label: 'Source', sortField: 'source', filter: sourceFilter },
    {
      label: 'Status',
      sortField: 'status',
      filter: {
        id: 'status',
        anyLabel: 'Any status',
        options: statusOptions(optionSource),
        value: filters.status,
        onChange: (value) => set('status', value),
      },
    },
    {
      label: 'Priority',
      sortField: 'priority',
      filter: {
        id: 'priority',
        anyLabel: 'Any priority',
        options: priorityOptions(optionSource),
        value: filters.priority,
        onChange: (value) => set('priority', value),
        extraOptions: [{ value: NO_PRIORITY, label: 'No priority' }],
      },
    },
    {
      label: 'Assignees',
      filter: {
        id: 'assignee',
        anyLabel: 'Anyone',
        options: assigneeOptions(optionSource),
        value: filters.assignee,
        onChange: (value) => set('assignee', value),
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
        id: 'container',
        anyLabel: 'All projects',
        options: containerOptions(optionSource),
        value: filters.container,
        onChange: (value) => set('container', value),
      },
    },
    { label: 'Updated', sortField: 'updated' },
  ];

  // The compact table's header controls. A compact row has no column per fact,
  // so the sorting and filtering those columns' headers carry is gathered into
  // one menu, and Open/Closed sits beside it rather than up in the toolbar.
  const openClosedToggle = (
    <TicketOpenClosedToggle
      // Two tables are mounted, one per view; each needs its own switcher.
      name={`tickets-open-closed-${boardView ? 'board' : 'all'}`}
      showClosed={showClosed}
      onShowClosedChange={onShowClosedChange}
      openCount={openCount}
      closedCount={closedCount}
      loading={loading}
    />
  );
  const sortFilterMenu = (
    <TicketSortFilterMenu
      columns={[TITLE_COLUMN, ...columns]}
      onClearFilters={onClearFilters}
      {...headerProps}
    />
  );

  const scrollRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [listKey]);

  return (
    <>
      {errors.length > 0 && (
        <ul
          className="shrink-0 border-b border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
          aria-label="Source load errors"
        >
          {errors.map((error) => (
            <li key={error.sourceId} className="flex items-center gap-2 px-4 py-2">
              <FontAwesomeIcon
                icon={faTriangleExclamation}
                className="text-xs text-amber-600 dark:text-amber-500"
              />
              <Text size="xs" className="text-amber-800 dark:text-amber-300">
                Couldn’t load {SOURCE_LABELS[error.sourceId]} tickets: {error.message}
              </Text>
            </li>
          ))}
        </ul>
      )}

      {/* Announced to screen readers when filters change the result count. */}
      <div className="sr-only" role="status" aria-live="polite">
        {loading
          ? 'Loading tickets'
          : `${totalCount} ${showClosed ? 'closed' : 'open'} ticket${totalCount === 1 ? '' : 's'}`}
      </div>

      {!loading && tickets.length === 0 ? (
        <>
          {/* No table, so no header: on a phone its controls are the only way
              back from an empty Closed list or a filter that matches nothing. */}
          {compact && (
            <div className="ticket-table-empty-controls flex shrink-0 items-center justify-end gap-3 border-b border-border px-4 py-2">
              {openClosedToggle}
              {sortFilterMenu}
            </div>
          )}
          {emptyState}
        </>
      ) : (
        <ScrollArea ref={scrollRef} orientation="both" className={SCROLL_AREA_CLASS}>
          <Table
            aria-label={showClosed ? 'Closed tickets' : 'Open tickets'}
            responsive={false}
            className="table-fixed"
            style={{ minWidth: tableMinWidth }}
          >
            <colgroup>
              {showSelectColumn && <col style={{ width: COLUMN_WIDTH.select }} />}
              <col style={{ width: quickActionsWidth }} />
              <col />
              {!compact && (
                <>
                  <col style={{ width: COLUMN_WIDTH.ref }} />
                  <col style={{ width: COLUMN_WIDTH.source }} />
                  <col style={{ width: COLUMN_WIDTH.status }} />
                  <col style={{ width: COLUMN_WIDTH.priority }} />
                  <col style={{ width: COLUMN_WIDTH.assignees }} />
                  <col style={{ width: COLUMN_WIDTH.container }} />
                  <col style={{ width: COLUMN_WIDTH.updated }} />
                </>
              )}
              <col style={{ width: COLUMN_WIDTH.actions }} />
            </colgroup>
            <TableHeader className="sticky top-0 z-10 bg-neutral-50 dark:bg-neutral-900">
              <TableRow>
                {showSelectColumn && (
                  <TableHead className="pl-4">
                    <Checkbox
                      checked={allSelected}
                      indeterminate={someSelected}
                      onChange={(e) => onSelectAllChange(e.target.checked)}
                      aria-label={allSelected ? 'Deselect all tickets' : 'Select all tickets'}
                    />
                  </TableHead>
                )}

                <TableHead>
                  <span className="sr-only">{boardText.columnHeading}</span>
                </TableHead>

                <TicketColumnHeader
                  {...TITLE_COLUMN}
                  {...headerProps}
                  trailing={compact ? openClosedToggle : undefined}
                />
                {!compact &&
                  columns.map((column) => (
                    <TicketColumnHeader key={column.label} {...column} {...headerProps} />
                  ))}

                <TableHead className="pr-4 text-end">
                  {compact ? sortFilterMenu : <span className="sr-only">Actions</span>}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tickets.map((ticket) => (
                <TicketTableRow
                  key={ticket.key}
                  ticket={ticket}
                  isCreator={isCreator(ticket)}
                  selected={selectedKeys.has(ticket.key)}
                  onSelectedChange={onSelectedChange}
                  isTimerRunning={runningTicketKey === ticket.key}
                  timerLoading={timerLoadingKey === ticket.key}
                  // One timer start or stop at a time (TicketStartProvider).
                  timerDisabled={timerLoadingKey !== null}
                  onToggleTimer={onToggleTimer}
                  onBoard={isOnBoard(ticket)}
                  boardLoading={boardLoadingKey === ticket.key}
                  onToggleBoard={onToggleBoard}
                  showSelectColumn={showSelectColumn}
                  compact={compact}
                  onEditRequest={onEditRequest}
                  onDeleteRequest={onDeleteRequest}
                  onChangeStatusRequest={onChangeStatusRequest}
                />
              ))}
              {/* Sources load independently: Huddle rows arrive at once, Redmine can
                  take seconds. Placeholders stay under the loaded rows until every
                  source has answered, so a slow source never looks like "no more". */}
              {loading &&
                Array.from(
                  { length: tickets.length ? SKELETON_ROWS_TRAILING : SKELETON_ROWS_EMPTY },
                  (_, i) => (
                    <SkeletonRow
                      key={`skeleton-${i}`}
                      columnCount={columnCount}
                      titleIndex={(showSelectColumn ? 1 : 0) + 1}
                      hasSelect={showSelectColumn}
                    />
                  ),
                )}
            </TableBody>
          </Table>
        </ScrollArea>
      )}
    </>
  );
};
