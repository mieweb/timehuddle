/**
 * Filter + sort state for the ticket table, and the pure logic that applies it.
 *
 * Kept free of React so the table's behaviour can be unit-tested directly. The
 * option lists are derived from the tickets actually loaded rather than from
 * fixed vocabularies, because each source names its statuses and priorities
 * differently.
 */
import type { TicketSourceId, UnifiedTicket } from './sources';

/** Sentinel for the "Unassigned" assignee option. */
export const UNASSIGNED = '__unassigned__';
/** Sentinel for the "No priority" option. */
export const NO_PRIORITY = '__none__';

export interface TicketFilters {
  /** Empty means "every source" — no source is hidden by default. */
  sources: TicketSourceId[];
  status: string | null;
  priority: string | null;
  assignee: string | null;
  container: string | null;
}

export const EMPTY_FILTERS: TicketFilters = {
  sources: [],
  status: null,
  priority: null,
  assignee: null,
  container: null,
};

export const hasActiveFilters = (f: TicketFilters): boolean =>
  f.sources.length > 0 || Boolean(f.status || f.priority || f.assignee || f.container);

/** A selectable value in a column's filter menu. */
export interface FilterOption {
  value: string;
  label: string;
  /** Set when options from different sources must be visually separated. */
  group?: TicketSourceId;
}

/** Status vocabularies differ per source, so options stay grouped by source. */
export function statusOptions(tickets: UnifiedTicket[]): FilterOption[] {
  const grouped = new Map<TicketSourceId, Set<string>>();
  for (const ticket of tickets) {
    const set = grouped.get(ticket.sourceId) ?? new Set<string>();
    set.add(ticket.status.native);
    grouped.set(ticket.sourceId, set);
  }
  return [...grouped.entries()].flatMap(([sourceId, statuses]) =>
    [...statuses].sort().map((status) => ({ value: status, label: status, group: sourceId })),
  );
}

/** Highest rank first, so the menu reads most-urgent to least. */
export function priorityOptions(tickets: UnifiedTicket[]): FilterOption[] {
  const seen = new Map<string, number>();
  for (const ticket of tickets) {
    if (ticket.priority) seen.set(ticket.priority.native, ticket.priority.rank);
  }
  return [...seen.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([native]) => ({ value: native, label: native }));
}

/**
 * Assignee options keyed by source-namespaced id — Huddle and Redmine user ids
 * are different namespaces that may collide.
 */
export function assigneeOptions(tickets: UnifiedTicket[]): FilterOption[] {
  const grouped = new Map<TicketSourceId, Map<string, string>>();
  for (const ticket of tickets) {
    const bySource = grouped.get(ticket.sourceId) ?? new Map<string, string>();
    for (const assignee of ticket.assignees) {
      bySource.set(`${ticket.sourceId}:${assignee.id}`, assignee.name);
    }
    grouped.set(ticket.sourceId, bySource);
  }
  return [...grouped.entries()].flatMap(([sourceId, bySource]) =>
    [...bySource.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label, group: sourceId })),
  );
}

export function containerOptions(tickets: UnifiedTicket[]): FilterOption[] {
  const seen = new Map<string, string>();
  for (const ticket of tickets) {
    if (ticket.container) {
      seen.set(`${ticket.sourceId}:${ticket.container.id}`, ticket.container.name);
    }
  }
  return [...seen.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([value, label]) => ({ value, label }));
}

/** Columns the table can sort by. Mirrors the sortable table headers. */
export type SortField =
  'title' | 'ref' | 'source' | 'status' | 'priority' | 'container' | 'updated';

export type SortDirection = 'asc' | 'desc';

export interface SortSpec {
  field: SortField;
  direction: SortDirection;
}

/** Newest-first is the useful default for a work queue. */
export const DEFAULT_SORT: SortSpec = { field: 'updated', direction: 'desc' };

/**
 * Next sort state for a header click: a new column starts at its natural
 * direction, the active column flips.
 */
export function toggleSort(current: SortSpec, field: SortField): SortSpec {
  if (current.field === field) {
    return { field, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  }
  // Dates and priority read best highest-first; text reads best A–Z.
  const startsDescending = field === 'updated' || field === 'priority';
  return { field, direction: startsDescending ? 'desc' : 'asc' };
}

/** Match a query against the fields a user would reasonably search by. */
export function matchesSearch(ticket: UnifiedTicket, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    ticket.title.toLowerCase().includes(q) ||
    ticket.ref.toLowerCase().includes(q) ||
    (ticket.container?.name.toLowerCase().includes(q) ?? false) ||
    (ticket.externalRef?.url.toLowerCase().includes(q) ?? false)
  );
}

export function applyFilters(
  tickets: UnifiedTicket[],
  filters: TicketFilters,
  query: string,
): UnifiedTicket[] {
  return tickets.filter((ticket) => {
    if (!matchesSearch(ticket, query)) return false;
    // An empty source selection means "every source", not "none".
    if (filters.sources.length > 0 && !filters.sources.includes(ticket.sourceId)) return false;
    if (filters.status && ticket.status.native !== filters.status) return false;

    if (filters.priority === NO_PRIORITY) {
      if (ticket.priority) return false;
    } else if (filters.priority && ticket.priority?.native !== filters.priority) {
      return false;
    }

    if (filters.assignee === UNASSIGNED) {
      if (ticket.assignees.length > 0) return false;
    } else if (filters.assignee) {
      // Assignee keys are source-namespaced; see TicketFilterBar.
      const match = ticket.assignees.some((a) => `${ticket.sourceId}:${a.id}` === filters.assignee);
      if (!match) return false;
    }

    if (
      filters.container &&
      (!ticket.container || `${ticket.sourceId}:${ticket.container.id}` !== filters.container)
    ) {
      return false;
    }

    return true;
  });
}

function compare(a: UnifiedTicket, b: UnifiedTicket, field: SortField): number {
  switch (field) {
    case 'title':
      return a.title.localeCompare(b.title);
    case 'ref':
      return a.ref.localeCompare(b.ref, undefined, { numeric: true });
    case 'source':
      return a.sourceId.localeCompare(b.sourceId);
    case 'status':
      return a.status.native.localeCompare(b.status.native);
    case 'priority':
      return (a.priority?.rank ?? 0) - (b.priority?.rank ?? 0);
    case 'container':
      return (a.container?.name ?? '').localeCompare(b.container?.name ?? '');
    case 'updated':
    default: {
      // Fall back to createdAt so a never-updated ticket still sorts sensibly.
      const aDate = a.updatedAt ?? a.createdAt;
      const bDate = b.updatedAt ?? b.createdAt;
      if (!aDate || !bDate) return 0;
      return new Date(aDate).getTime() - new Date(bDate).getTime();
    }
  }
}

export function sortTickets(tickets: UnifiedTicket[], sort: SortSpec): UnifiedTicket[] {
  const factor = sort.direction === 'asc' ? 1 : -1;
  return [...tickets].sort((a, b) => {
    // Undated rows stay at the bottom in both directions rather than being
    // treated as the oldest or the newest.
    if (sort.field === 'updated') {
      const aDated = Boolean(a.updatedAt ?? a.createdAt);
      const bDated = Boolean(b.updatedAt ?? b.createdAt);
      if (aDated !== bDated) return aDated ? -1 : 1;
    }
    const result = compare(a, b, sort.field);
    // Title breaks ties so equal-ranked rows keep a stable, readable order.
    return result !== 0 ? result * factor : a.title.localeCompare(b.title);
  });
}
