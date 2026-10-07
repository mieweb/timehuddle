/**
 * Search + filter + sort + select pipeline for a `TicketList`.
 *
 * A hook so each tab (Tickets, My Board) runs the same pipeline over its own
 * ticket list with fully independent state — switching tabs must never reset
 * or leak the other tab's search, filters, sort, or selection.
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
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  filters: TicketFilters;
  setFilters: (filters: TicketFilters) => void;
  clearFilters: () => void;
  sort: SortSpec;
  onSortChange: (field: SortField) => void;
  showClosed: boolean;
  setShowClosed: (showClosed: boolean) => void;
  openFilterMenu: string | null;
  onOpenFilterMenuChange: (menuId: string | null) => void;
  /** Everything matching the search + filter chips, before the Open/Closed split. */
  searchFilteredTickets: UnifiedTicket[];
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
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<TicketFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortSpec>(DEFAULT_SORT);
  const [showClosed, setShowClosed] = useState(false);
  const [openFilterMenu, setOpenFilterMenu] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const clearFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);
  const clearSelection = useCallback(() => setSelectedKeys(new Set()), []);

  const searchFilteredTickets = useMemo(
    () => applyFilters(tickets, filters, searchQuery, meKeys),
    [tickets, filters, searchQuery, meKeys],
  );

  const openCount = useMemo(
    () => searchFilteredTickets.filter((t) => !t.status.isClosed).length,
    [searchFilteredTickets],
  );
  const closedCount = useMemo(
    () => searchFilteredTickets.filter((t) => t.status.isClosed).length,
    [searchFilteredTickets],
  );

  const sortedTickets = useMemo(
    () =>
      sortTickets(
        searchFilteredTickets.filter((t) => t.status.isClosed === showClosed),
        sort,
      ),
    [searchFilteredTickets, showClosed, sort],
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
    searchQuery,
    setSearchQuery,
    filters,
    setFilters,
    clearFilters,
    sort,
    onSortChange,
    showClosed,
    setShowClosed,
    openFilterMenu,
    onOpenFilterMenuChange: setOpenFilterMenu,
    searchFilteredTickets,
    openCount,
    closedCount,
    sortedTickets,
    selectedKeys,
    onSelectedChange,
    onSelectAllChange,
    clearSelection,
  };
}
