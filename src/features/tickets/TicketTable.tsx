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
} from '@mieweb/ui';
import React from 'react';

import { MINIMAL_SCROLLBAR_CLASS } from '../../ui/scrollbar';

import { TicketColumnHeader, type TicketColumnFilter } from './TicketColumnHeader';
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

/** Column count including select and actions (the timer column is extra). */
const COLUMN_COUNT = 10;

/**
 * Fixed pixel width per column (Title excepted, which flexes to fill the
 * remainder). Paired with `table-fixed` so widths come only from here and
 * never from row content — without this, a longer badge or name on one page
 * resizes every column, which is the jump this fixes.
 */
const COLUMN_WIDTH = {
  select: 44,
  timer: 56,
  ref: 90,
  source: 130,
  status: 140,
  priority: 130,
  assignees: 140,
  container: 170,
  updated: 120,
  actions: 56,
};

/** Sum of the fixed columns plus a readable floor for the flexible Title column. */
const FIXED_COLUMN_WIDTH = Object.entries(COLUMN_WIDTH)
  .filter(([key]) => key !== 'timer')
  .reduce((sum, [, w]) => sum + w, 0);
const TABLE_MIN_WIDTH = FIXED_COLUMN_WIDTH + 220;

// The app's minimal scrollbar, as a thin horizontal bar.
const SCROLLBAR_CLASS = `w-full [&::-webkit-scrollbar]:h-1.5 ${MINIMAL_SCROLLBAR_CLASS}`;

export interface TicketTableProps {
  /** One page of rows, already filtered and sorted. */
  tickets: UnifiedTicket[];
  /** Everything matching the search, used to build the filter menus. */
  optionSource: UnifiedTicket[];
  loading: boolean;
  errors: { sourceId: TicketSourceId; message: string }[];
  isCreator: (ticket: UnifiedTicket) => boolean;
  sort: SortSpec;
  onSortChange: (field: SortField) => void;
  filters: TicketFilters;
  onFiltersChange: (filters: TicketFilters) => void;
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
  emptyState: React.ReactNode;
  onToggleTimer: (ticket: UnifiedTicket) => void;
  /** My Board only — see `TicketTableRow`. */
  showTimerColumn?: boolean;
  onEditRequest: (ticket: UnifiedTicket) => void;
  onDeleteRequest: (ticket: UnifiedTicket) => void;
  onChangeStatusRequest: (ticket: UnifiedTicket) => void;
}

/** How many placeholder rows sit under the loaded ones while a source is still loading. */
const SKELETON_ROWS_EMPTY = 5;
const SKELETON_ROWS_TRAILING = 3;

/**
 * A placeholder row shaped like a real one: a checkbox, a long title, and a
 * short bar per remaining column. The title is the one column that flexes.
 */
const SkeletonRow: React.FC<{ columnCount: number; titleIndex: number }> = ({
  columnCount,
  titleIndex,
}) => (
  <TableRow aria-hidden="true" className="ticket-skeleton-row">
    {Array.from({ length: columnCount }, (_, i) => (
      <TableCell key={i} className={i === 0 ? 'pl-4' : i === columnCount - 1 ? 'pr-4' : undefined}>
        {i === 0 ? (
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
  optionSource,
  loading,
  errors,
  isCreator,
  sort,
  onSortChange,
  filters,
  onFiltersChange,
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
  emptyState,
  onToggleTimer,
  showTimerColumn = false,
  onEditRequest,
  onDeleteRequest,
  onChangeStatusRequest,
}) => {
  const selectedOnPage = tickets.filter((t) => selectedKeys.has(t.key)).length;
  const allSelected = tickets.length > 0 && selectedOnPage === tickets.length;
  const someSelected = selectedOnPage > 0 && !allSelected;
  const columnCount = COLUMN_COUNT + (showTimerColumn ? 1 : 0);
  const tableMinWidth = TABLE_MIN_WIDTH + (showTimerColumn ? COLUMN_WIDTH.timer : 0);

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

  return (
    <>
      {errors.length > 0 && (
        <ul
          className="border-b border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
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
        emptyState
      ) : (
        <ScrollArea orientation="horizontal" className={SCROLLBAR_CLASS}>
          <Table
            aria-label={showClosed ? 'Closed tickets' : 'Open tickets'}
            responsive={false}
            className="table-fixed"
            style={{ minWidth: tableMinWidth }}
          >
            <colgroup>
              <col style={{ width: COLUMN_WIDTH.select }} />
              {showTimerColumn && <col style={{ width: COLUMN_WIDTH.timer }} />}
              <col />
              <col style={{ width: COLUMN_WIDTH.ref }} />
              <col style={{ width: COLUMN_WIDTH.source }} />
              <col style={{ width: COLUMN_WIDTH.status }} />
              <col style={{ width: COLUMN_WIDTH.priority }} />
              <col style={{ width: COLUMN_WIDTH.assignees }} />
              <col style={{ width: COLUMN_WIDTH.container }} />
              <col style={{ width: COLUMN_WIDTH.updated }} />
              <col style={{ width: COLUMN_WIDTH.actions }} />
            </colgroup>
            <TableHeader className="sticky top-0 z-10 bg-neutral-50 dark:bg-neutral-900">
              <TableRow>
                <TableHead className="pl-4">
                  <Checkbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onChange={(e) => onSelectAllChange(e.target.checked)}
                    aria-label={allSelected ? 'Deselect all tickets' : 'Select all tickets'}
                  />
                </TableHead>

                {showTimerColumn && (
                  <TableHead>
                    <span className="sr-only">Timer</span>
                  </TableHead>
                )}

                <TicketColumnHeader label="Title" sortField="title" {...headerProps} />
                <TicketColumnHeader label="Issue #" sortField="ref" {...headerProps} />
                <TicketColumnHeader
                  label="Source"
                  sortField="source"
                  filter={sourceFilter}
                  {...headerProps}
                />
                <TicketColumnHeader
                  label="Status"
                  sortField="status"
                  filter={{
                    id: 'status',
                    anyLabel: 'Any status',
                    options: statusOptions(optionSource),
                    value: filters.status,
                    onChange: (value) => set('status', value),
                  }}
                  {...headerProps}
                />
                <TicketColumnHeader
                  label="Priority"
                  sortField="priority"
                  filter={{
                    id: 'priority',
                    anyLabel: 'Any priority',
                    options: priorityOptions(optionSource),
                    value: filters.priority,
                    onChange: (value) => set('priority', value),
                    extraOptions: [{ value: NO_PRIORITY, label: 'No priority' }],
                  }}
                  {...headerProps}
                />
                <TicketColumnHeader
                  label="Assignees"
                  filter={{
                    id: 'assignee',
                    anyLabel: 'Anyone',
                    options: assigneeOptions(optionSource),
                    value: filters.assignee,
                    onChange: (value) => set('assignee', value),
                    // "Me" first: it is the shortcut people reach for most, and
                    // it spans every source at once (see the ME sentinel).
                    extraOptions: [
                      { value: ME, label: 'Me' },
                      { value: UNASSIGNED, label: 'Unassigned' },
                    ],
                  }}
                  {...headerProps}
                />
                <TicketColumnHeader
                  label="Project"
                  sortField="container"
                  filter={{
                    id: 'container',
                    anyLabel: 'All projects',
                    options: containerOptions(optionSource),
                    value: filters.container,
                    onChange: (value) => set('container', value),
                  }}
                  {...headerProps}
                />
                <TicketColumnHeader label="Updated" sortField="updated" {...headerProps} />

                <TableHead className="pr-4">
                  <span className="sr-only">Actions</span>
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
                  showTimerColumn={showTimerColumn}
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
                      titleIndex={showTimerColumn ? 2 : 1}
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
