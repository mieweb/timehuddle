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
import { Checkbox, Text, useMediaQuery } from '@mieweb/ui';
import React from 'react';

import { RowList } from '../../ui/RowList';

import { TicketRow } from './TicketRow';
import { TicketOpenClosedToggle } from './TicketOpenClosedToggle';
import { TicketListControls, type TicketField } from './TicketListControls';
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
  loading: 'Loading tickets',
  count: (count: number, showClosed: boolean) =>
    `${count} ${showClosed ? 'closed' : 'open'} ticket${count === 1 ? '' : 's'}`,
  loadError: (source: string, message: string) => `Couldn’t load ${source} tickets: ${message}`,
  loadErrors: 'Source load errors',
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
}

const ticketKey = (ticket: UnifiedTicket) => ticket.key;
const ticketTitle = (ticket: UnifiedTicket) => ticket.title;

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
}) => {
  // Each mounted list needs its own switcher name: it ties the sliding highlight.
  const stateSwitcherName = `ticket-state-${React.useId()}`;
  const compact = useMediaQuery('(max-width: 767px)');
  const showSelectionControls = !compact || selecting;
  const selectedOnPage = tickets.filter((t) => selectedKeys.has(t.key)).length;
  const allSelected = tickets.length > 0 && selectedOnPage === tickets.length;
  const someSelected = selectedOnPage > 0 && !allSelected;

  const set = <K extends keyof TicketFilters>(key: K, value: TicketFilters[K]) =>
    onFiltersChange({ ...filters, [key]: value });

  // In the order they are kept on the header's line as it narrows: the ones
  // reached for most come first. The registry drives the source options, so a
  // third source needs no change here.
  const fields: TicketField[] = [
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
    { label: 'Issue #', sortField: 'ref' },
    { label: 'Updated', sortField: 'updated' },
    { label: 'Title', sortField: 'title' },
  ];

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
        renderRow={(ticket) => (
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
          />
        )}
      />
    </>
  );
};
