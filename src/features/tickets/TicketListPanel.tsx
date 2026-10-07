/**
 * TicketListPanel — one tab's worth of the Tickets page: the bulk action bar
 * and the list card.
 *
 * All Sources and My Board render the same panel over their own
 * `TicketTableView`; what differs between them (the notices around the bulk
 * bar, the labels) comes in as props. The search bar is not here: one sits
 * above both tabs, on the page.
 */
import { Card } from '@mieweb/ui';
import React from 'react';

import { EmptyState } from '../../ui/EmptyState';
import { TicketBulkActionBar } from './TicketBulkActionBar';
import { TicketList, type TicketListProps } from './TicketList';
import { hasActiveFilters } from './ticketFilters';
import type { TicketTableView } from './useTicketTableView';

type SharedListProps = Pick<
  TicketListProps,
  | 'errors'
  | 'isCreator'
  | 'runningTicketKey'
  | 'timerLoadingKey'
  | 'onToggleTimer'
  | 'showTimer'
  | 'onEditRequest'
  | 'onDeleteRequest'
  | 'onChangeStatusRequest'
>;

export interface TicketListPanelProps extends SharedListProps {
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

export const TicketListPanel: React.FC<TicketListPanelProps> = ({
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
  ...listProps
}) => {
  const cardRef = React.useRef<HTMLDivElement>(null);
  const filtersActive = hasActiveFilters(view.filters);
  const filtered = Boolean(view.searchQuery) || filtersActive;
  // What decides which rows are listed and in what order. When it changes the
  // list goes back to its first row.
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

      {/* Fills the remaining height, as a column: a source-error banner takes
          what it needs and the rows scroll in the rest, under a fixed header. */}
      <Card
        ref={cardRef}
        padding="none"
        className="ticket-list-card flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <TicketList
          {...listProps}
          tickets={view.sortedTickets}
          listKey={listKey}
          optionSource={view.searchFilteredTickets}
          loading={loading}
          sort={view.sort}
          onSortChange={view.onSortChange}
          filters={view.filters}
          onFiltersChange={view.setFilters}
          filtersActive={filtersActive}
          onClearFilters={view.clearFilters}
          openMenuId={view.openFilterMenu}
          onOpenMenuChange={view.onOpenFilterMenuChange}
          boundaryRef={cardRef}
          selectedKeys={view.selectedKeys}
          onSelectedChange={view.onSelectedChange}
          onSelectAllChange={view.onSelectAllChange}
          showClosed={view.showClosed}
          onShowClosedChange={view.setShowClosed}
          openCount={view.openCount}
          closedCount={view.closedCount}
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
      </Card>
    </>
  );
};
