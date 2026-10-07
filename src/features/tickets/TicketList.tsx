/**
 * TicketList — the unified ticket list, whatever the ticket's source.
 *
 * Purely presentational: it receives one already-filtered, already-sorted list
 * of tickets and reports per-source load failures, so a broken source cannot
 * blank out the sources that are working.
 *
 * One layout at every width: each ticket is a row carrying its properties, laid
 * out by the room the list has (see `RowList`). The header is the same at every
 * width too — select all and Open/Closed on the left, the one sort-and-filter
 * control on the right. Selection is host-owned.
 */
import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Checkbox, Text } from '@mieweb/ui';
import React from 'react';

import { RowList } from '../../ui/RowList';

import { TicketRow } from './TicketRow';
import { TicketOpenClosedToggle } from './TicketOpenClosedToggle';
import { TicketSortFilterMenu, type TicketField } from './TicketSortFilterMenu';
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
  /** My Board only — see `TicketRow`. */
  showTimer?: boolean;
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
  showTimer = false,
  onEditRequest,
  onDeleteRequest,
  onChangeStatusRequest,
}) => {
  // Each mounted list needs its own switcher name: it ties the sliding highlight.
  const stateSwitcherName = `ticket-state-${React.useId()}`;
  const selectedOnPage = tickets.filter((t) => selectedKeys.has(t.key)).length;
  const allSelected = tickets.length > 0 && selectedOnPage === tickets.length;
  const someSelected = selectedOnPage > 0 && !allSelected;

  const set = <K extends keyof TicketFilters>(key: K, value: TicketFilters[K]) =>
    onFiltersChange({ ...filters, [key]: value });

  // Every field the list sorts or filters by, gathered into the one menu. The
  // registry drives the source options, so a third source needs no change here.
  const fields: TicketField[] = [
    { label: 'Title', sortField: 'title' },
    { label: 'Issue #', sortField: 'ref' },
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
        value: filters.sources.length === 1 ? filters.sources[0] : null,
        onChange: (value) => set('sources', value ? [value as TicketSourceId] : []),
      },
    },
    {
      label: 'Status',
      sortField: 'status',
      filter: {
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
        anyLabel: 'All projects',
        options: containerOptions(optionSource),
        value: filters.container,
        onChange: (value) => set('container', value),
      },
    },
    { label: 'Updated', sortField: 'updated' },
  ];

  const header = (
    <>
      {selecting && (
        <Checkbox
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
      <div className="ticket-list-tools ms-auto flex items-center gap-1">
        <TicketSortFilterMenu
          fields={fields}
          sort={sort}
          onSortChange={onSortChange}
          onClearFilters={onClearFilters}
          openMenuId={openMenuId}
          onOpenMenuChange={onOpenMenuChange}
          boundaryRef={boundaryRef}
        />
      </div>
    </>
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
            selecting={selecting}
            onSelectedChange={onSelectedChange}
            isTimerRunning={runningTicketKey === ticket.key}
            timerLoading={timerLoadingKey === ticket.key}
            // One timer start or stop at a time (TicketStartProvider).
            timerDisabled={timerLoadingKey !== null}
            onToggleTimer={onToggleTimer}
            showTimer={showTimer}
            onEditRequest={onEditRequest}
            onDeleteRequest={onDeleteRequest}
            onChangeStatusRequest={onChangeStatusRequest}
          />
        )}
      />
    </>
  );
};
