/**
 * Filter + sort + select pipeline for a `TicketList`.
 *
 * A hook so each tab (Tickets, My Board) runs the same pipeline over its own
 * ticket list with fully independent state — switching tabs must never reset
 * or leak the other tab's filters, sort, or selection. The search bar does not
 * filter the table: its results are in its own dropdown (#736c).
 */
import { useCallback, useMemo, useState } from 'react';

import {
  applyFilters,
  sortTickets,
  toggleSort,
  DEFAULT_SORT,
  EMPTY_FILTERS,
  type SortField,
  type SortSpec,
  type TicketFilters,
} from './ticketFilters';
import type { UnifiedTicket } from './sources';

export interface TicketTableView {
  filters: TicketFilters;
  setFilters: (filters: TicketFilters) => void;
  clearFilters: () => void;
  sort: SortSpec;
  onSortChange: (field: SortField) => void;
  showClosed: boolean;
  setShowClosed: (showClosed: boolean) => void;
  openFilterMenu: string | null;
  onOpenFilterMenuChange: (menuId: string | null) => void;
  /** Everything matching the filter chips, before the Open/Closed split. */
  filteredTickets: UnifiedTicket[];
  /**
   * Every ticket the tab lists, unfiltered. What the filter menus build their
   * choices from: built from the filtered list, choosing one project would
   * take every other project out of the menu it was chosen in.
   */
  tickets: UnifiedTicket[];
  openCount: number;
  closedCount: number;
  /** The rows the list shows: filtered, split by Open/Closed, and sorted. */
  sortedTickets: UnifiedTicket[];
  selectedKeys: Set<string>;
  onSelectedChange: (ticket: UnifiedTicket, selected: boolean) => void;
  onSelectAllChange: (selected: boolean) => void;
  clearSelection: () => void;
}

export function useTicketTableView(
  tickets: UnifiedTicket[],
  meKeys: readonly string[] = [],
): TicketTableView {
  const [filters, setFilters] = useState<TicketFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortSpec>(DEFAULT_SORT);
  const [showClosed, setShowClosed] = useState(false);
  const [openFilterMenu, setOpenFilterMenu] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const clearFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);
  const clearSelection = useCallback(() => setSelectedKeys(new Set()), []);

  const filteredTickets = useMemo(
    () => applyFilters(tickets, filters, meKeys),
    [tickets, filters, meKeys],
  );

  const openCount = useMemo(
    () => filteredTickets.filter((t) => !t.status.isClosed).length,
    [filteredTickets],
  );
  const closedCount = useMemo(
    () => filteredTickets.filter((t) => t.status.isClosed).length,
    [filteredTickets],
  );

  const sortedTickets = useMemo(
    () =>
      sortTickets(
        filteredTickets.filter((t) => t.status.isClosed === showClosed),
        sort,
      ),
    [filteredTickets, showClosed, sort],
  );

  const onSortChange = useCallback((field: SortField) => {
    setSort((current) => toggleSort(current, field));
  }, []);

  const onSelectedChange = useCallback((ticket: UnifiedTicket, selected: boolean) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (selected) next.add(ticket.key);
      else next.delete(ticket.key);
      return next;
    });
  }, []);

  // Select-all applies to every row listed: they are all one scroll away.
  const onSelectAllChange = useCallback(
    (selected: boolean) => {
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        for (const ticket of sortedTickets) {
          if (selected) next.add(ticket.key);
          else next.delete(ticket.key);
        }
        return next;
      });
    },
    [sortedTickets],
  );

  return {
    filters,
    setFilters,
    clearFilters,
    sort,
    onSortChange,
    showClosed,
    setShowClosed,
    openFilterMenu,
    onOpenFilterMenuChange: setOpenFilterMenu,
    filteredTickets,
    tickets,
    openCount,
    closedCount,
    sortedTickets,
    selectedKeys,
    onSelectedChange,
    onSelectAllChange,
    clearSelection,
  };
}
