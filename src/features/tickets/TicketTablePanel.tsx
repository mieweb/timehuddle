/**
 * TicketTablePanel — one tab's worth of the Tickets page: the toolbar, the bulk
 * action bar and the table card.
 *
 * The Tickets tab and My Board render the same panel over their own
 * `TicketTableView`; what differs between them (the search control, the notices
 * around the bulk bar, the labels) comes in as props.
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
  /** The leading toolbar content: this tab's search control and anything beside it. */
  search: React.ReactNode;
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
}

export const TicketTablePanel: React.FC<TicketTablePanelProps> = ({
  view,
  loading,
  search,
  afterBulkBar,
  canDeleteSelected,
  onBulkDelete,
  primaryLabel,
  onPrimaryAction,
  emptyText,
  emptyNotice,
  ...tableProps
}) => {
  const cardRef = React.useRef<HTMLDivElement>(null);
  const filtered = Boolean(view.searchQuery) || hasActiveFilters(view.filters);

  return (
    <>
      <div className="sticky top-0 z-20 -mx-4 border-b border-neutral-200 bg-neutral-50/95 px-4 py-2 backdrop-blur supports-backdrop-filter:bg-neutral-50/80 dark:border-neutral-800 dark:bg-neutral-950/95 dark:supports-backdrop-filter:bg-neutral-950/80 md:static md:z-auto md:mx-0 md:border-0 md:bg-transparent md:px-0 md:py-0">
        <div className="flex items-center gap-2">
          {search}

          <div className="flex shrink-0 items-center gap-3">
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
        </div>
      </div>

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
        {/* Fills the remaining height; the table scrolls inside it, under a fixed header. */}
        <div className="ticket-table-area min-h-0 flex-1 overflow-hidden">
          <TicketTable
            {...tableProps}
            tickets={view.sortedTickets}
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
              />
            }
          />
        </div>
      </Card>
    </>
  );
};
