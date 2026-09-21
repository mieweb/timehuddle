/**
 * Search + filter + sort + paginate + select pipeline for a `TicketTable`.
 *
 * Extracted out of `TicketsPage` so a second table view (My Board) can run the
 * exact same pipeline over a different ticket list with fully independent
 * state — switching tabs must never reset or leak the other tab's search,
 * filters, sort, page, or selection.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

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
import { useAutoPageSize } from './useAutoPageSize';

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
  page: number;
  setPage: (page: number) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Everything matching the search + filter chips, before the Open/Closed split. */
  searchFilteredTickets: UnifiedTicket[];
  openCount: number;
  closedCount: number;
  sortedTickets: UnifiedTicket[];
  pageTickets: UnifiedTicket[];
  totalPages: number;
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
  const [page, setPage] = useState(1);
  const { containerRef, pageSize } = useAutoPageSize();

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

  const totalPages = Math.max(1, Math.ceil(sortedTickets.length / pageSize));

  // Clamp rather than reset: shrinking the window or tightening a filter should
  // land on the last real page, not silently jump the user back to page 1.
  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  // Any change to what is listed invalidates the current page position.
  useEffect(() => {
    setPage(1);
  }, [searchQuery, filters, showClosed]);

  const pageTickets = useMemo(
    () => sortedTickets.slice((page - 1) * pageSize, page * pageSize),
    [sortedTickets, page, pageSize],
  );

  const onSortChange = useCallback((field: SortField) => {
    setSort((current) => toggleSort(current, field));
    setPage(1);
  }, []);

  const onSelectedChange = useCallback((ticket: UnifiedTicket, selected: boolean) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (selected) next.add(ticket.key);
      else next.delete(ticket.key);
      return next;
    });
  }, []);

  // Select-all applies to the current page only, matching what the user sees.
  const onSelectAllChange = useCallback(
    (selected: boolean) => {
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        for (const ticket of pageTickets) {
          if (selected) next.add(ticket.key);
          else next.delete(ticket.key);
        }
        return next;
      });
    },
    [pageTickets],
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
    page,
    setPage,
    containerRef,
    searchFilteredTickets,
    openCount,
    closedCount,
    sortedTickets,
    pageTickets,
    totalPages,
    selectedKeys,
    onSelectedChange,
    onSelectAllChange,
    clearSelection,
  };
}
