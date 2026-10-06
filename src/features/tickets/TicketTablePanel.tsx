/**
 * TicketTablePanel — one tab's worth of the Tickets page: the bulk action bar
 * and the table card.
 *
 * All Sources and My Board render the same panel over their own
 * `TicketTableView`; what differs between them (the notices around the bulk
 * bar, the labels) comes in as props. The toolbar is not here: one search bar
 * sits above both tabs, on the page, with `TicketViewControls` beside it.
 */
import { Button, Card, Switch, Text } from '@mieweb/ui';
import React from 'react';

import { EmptyState } from '../../ui/EmptyState';
import { TicketBulkActionBar } from './TicketBulkActionBar';
import { TicketTable, type TicketTableProps } from './TicketTable';
import { hasActiveFilters } from './ticketFilters';
import type { TicketTableView } from './useTicketTableView';

type SharedTableProps = Pick<
  TicketTableProps,
  | 'errors'
  | 'isCreator'
  | 'runningTicketKey'
  | 'timerLoadingKey'
  | 'onToggleTimer'
  | 'showTimerColumn'
  | 'onEditRequest'
  | 'onDeleteRequest'
  | 'onChangeStatusRequest'
>;

export interface TicketTablePanelProps extends SharedTableProps {
  view: TicketTableView;
  loading: boolean;
  /** Notices rendered below the bulk action bar. */
  afterBulkBar?: React.ReactNode;
  canDeleteSelected: boolean;
  onBulkDelete: () => void;
  primaryLabel: string;
  onPrimaryAction: () => void;
  /** Empty-state titles, and the hint shown when nothing is filtered. */
  emptyText: { open: string; closed: string; hint: string };
  /** Replaces the empty-state description when set. */
  emptyNotice?: string | null;
  /** Call to action under the hint, shown only when the hint would be. */
  emptyAction?: React.ReactNode;
}

/**
 * The count and the Open/Closed switch for one view, with "Clear filters" when
 * any are set. Rendered by the page beside the search bar, for whichever view
 * is showing, so the bar reads the same on both tabs.
 */
export const TicketViewControls: React.FC<{ view: TicketTableView; loading: boolean }> = ({
  view,
  loading,
}) => (
  <div className="ticket-view-controls flex shrink-0 items-center gap-3">
    <Text size="xs" variant="muted" className="hidden whitespace-nowrap sm:block">
      {loading ? '…' : `${view.openCount} open · ${view.closedCount} closed`}
    </Text>
    <Switch
      size="sm"
      label="Closed"
      labelPosition="left"
      checked={view.showClosed}
      onCheckedChange={view.setShowClosed}
    />
    {hasActiveFilters(view.filters) && (
      <Button
        variant="ghost"
        size="sm"
        className="whitespace-nowrap px-2 text-xs"
        onClick={view.clearFilters}
      >
        Clear filters
      </Button>
    )}
  </div>
);

export const TicketTablePanel: React.FC<TicketTablePanelProps> = ({
  view,
  loading,
  afterBulkBar,
  canDeleteSelected,
  onBulkDelete,
  primaryLabel,
  onPrimaryAction,
  emptyText,
  emptyNotice,
  emptyAction,
  ...tableProps
}) => {
  const cardRef = React.useRef<HTMLDivElement>(null);
  const filtered = Boolean(view.searchQuery) || hasActiveFilters(view.filters);
  // What decides which rows are listed and in what order. When it changes the
  // table goes back to its first row, as paging went back to page 1.
  const listKey = JSON.stringify([view.searchQuery, view.filters, view.sort, view.showClosed]);

  return (
    <>
      {view.selectedKeys.size > 0 && (
        <TicketBulkActionBar
          selectedCount={view.selectedKeys.size}
          onDeselectAll={view.clearSelection}
          canDeleteSelected={canDeleteSelected}
          onDelete={onBulkDelete}
          primaryLabel={primaryLabel}
          onPrimaryAction={onPrimaryAction}
        />
      )}

      {afterBulkBar}

      {/* A card on a wide screen. On a phone the frame goes and the table runs
          edge to edge, taking back the page's side padding for its columns. */}
      <Card
        ref={cardRef}
        padding="none"
        className="ticket-table-card flex min-h-0 flex-1 flex-col max-md:-mx-4 max-md:rounded-none max-md:border-x-0 max-md:border-b-0 max-md:bg-transparent max-md:shadow-none"
      >
        {/* Fills the remaining height, as a column: a source-error banner takes
            what it needs and the table scrolls in the rest, under a fixed header. */}
        <div className="ticket-table-area flex min-h-0 flex-1 flex-col overflow-hidden">
          <TicketTable
            {...tableProps}
            tickets={view.sortedTickets}
            listKey={listKey}
            optionSource={view.searchFilteredTickets}
            loading={loading}
            sort={view.sort}
            onSortChange={view.onSortChange}
            filters={view.filters}
            onFiltersChange={view.setFilters}
            openMenuId={view.openFilterMenu}
            onOpenMenuChange={view.onOpenFilterMenuChange}
            boundaryRef={cardRef}
            selectedKeys={view.selectedKeys}
            onSelectedChange={view.onSelectedChange}
            onSelectAllChange={view.onSelectAllChange}
            totalCount={view.sortedTickets.length}
            showClosed={view.showClosed}
            emptyState={
              <EmptyState
                title={
                  filtered
                    ? 'No tickets match your filters'
                    : view.showClosed
                      ? emptyText.closed
                      : emptyText.open
                }
                description={
                  emptyNotice ?? (!filtered && !view.showClosed ? emptyText.hint : undefined)
                }
                action={!emptyNotice && !filtered && !view.showClosed ? emptyAction : undefined}
              />
            }
          />
        </div>
      </Card>
    </>
  );
};
