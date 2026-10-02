/**
 * TicketTablePanel — one tab's worth of the Tickets page: the toolbar, the bulk
 * action bar, the table card and its pagination footer.
 *
 * The Tickets tab and My Board render the same panel over their own
 * `TicketTableView`; what differs between them (the search control, the notices
 * around the bulk bar, the labels) comes in as props.
 */
import { Button, Card, Pagination, Switch, Text } from '@mieweb/ui';
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
  /** Notices rendered above and below the bulk action bar. */
  beforeBulkBar?: React.ReactNode;
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
  beforeBulkBar,
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

      {beforeBulkBar}

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

      <Card ref={cardRef} padding="none" className="flex min-h-0 flex-1 flex-col">
        {/* Fills the remaining height; only the columns scroll, horizontally. */}
        <div ref={view.containerRef} className="min-h-0 flex-1 overflow-hidden">
          <TicketTable
            {...tableProps}
            tickets={view.pageTickets}
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

        {view.totalPages > 1 && (
          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-neutral-200 px-4 py-2 dark:border-neutral-700">
            <Text size="xs" variant="muted">
              {view.selectedKeys.size > 0
                ? `${view.selectedKeys.size} selected`
                : `${view.sortedTickets.length} ticket${view.sortedTickets.length === 1 ? '' : 's'}`}
            </Text>
            <Pagination
              page={view.page}
              totalPages={view.totalPages}
              onPageChange={view.setPage}
              size="sm"
              label="Ticket pages"
            />
          </div>
        )}
      </Card>
    </>
  );
};
