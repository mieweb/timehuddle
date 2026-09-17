/**
 * Tests for the unified list's search / filter / sort.
 *
 * The cases that matter are the cross-source ones: an empty source selection
 * meaning "all", source-namespaced assignee keys, and tickets with no dates
 * (Redmine issues from an older instance) not claiming the newest slot.
 */
import { describe, it, expect } from 'vitest';

import type { UnifiedTicket } from './sources';
import {
  applyFilters,
  sortTickets,
  toggleSort,
  DEFAULT_SORT,
  EMPTY_FILTERS,
  NO_PRIORITY,
  UNASSIGNED,
  assigneeOptions,
  priorityOptions,
  statusOptions,
  type TicketFilters,
} from './ticketFilters';

const make = (overrides: Partial<UnifiedTicket>): UnifiedTicket =>
  ({
    key: 'huddle:1',
    sourceId: 'huddle',
    id: '1',
    ref: '#1',
    title: 'Something',
    container: null,
    status: { native: 'open', isClosed: false },
    priority: null,
    assignees: [],
    createdBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    externalUrl: null,
    externalRef: null,
    sharedWithTimeharbor: false,
    capabilities: {
      edit: false,
      delete: false,
      assign: false,
      changeStatus: false,
      trackTime: false,
      openExternal: false,
    },
    ...overrides,
  }) as UnifiedTicket;

const huddle = make({ key: 'huddle:1', sourceId: 'huddle', id: '1', title: 'Alpha bug' });
const redmine = make({
  key: 'redmine:9',
  sourceId: 'redmine',
  id: '9',
  ref: '#9',
  title: 'Beta issue',
  container: { id: '7', name: 'Platform' },
  status: { native: 'Feedback', isClosed: false },
});
const all = [huddle, redmine];

const withFilters = (partial: Partial<TicketFilters>): TicketFilters => ({
  ...EMPTY_FILTERS,
  ...partial,
});

describe('filter option derivation', () => {
  it('groups statuses by source and keeps native names', () => {
    expect(statusOptions(all)).toEqual([
      { value: 'open', label: 'open', group: 'huddle' },
      { value: 'Feedback', label: 'Feedback', group: 'redmine' },
    ]);
  });

  it('orders priorities most urgent first, across source vocabularies', () => {
    const rows = [
      make({ key: 'a', priority: { native: 'low', rank: 1 } }),
      make({ key: 'b', priority: { native: 'Immediate', rank: 5 } }),
      make({ key: 'c', priority: { native: 'high', rank: 3 } }),
      make({ key: 'd', priority: null }),
    ];
    expect(priorityOptions(rows).map((o) => o.value)).toEqual(['Immediate', 'high', 'low']);
  });

  it('namespaces assignee option values by source', () => {
    const rows = [
      make({ key: 'a', sourceId: 'huddle', assignees: [{ id: 'u1', name: 'Ada' }] }),
      make({ key: 'b', sourceId: 'redmine', assignees: [{ id: 'u1', name: 'Ada' }] }),
    ];
    expect(assigneeOptions(rows).map((o) => o.value)).toEqual(['huddle:u1', 'redmine:u1']);
  });

  it('deduplicates repeated values', () => {
    const rows = [make({ key: 'a' }), make({ key: 'b' })];
    expect(statusOptions(rows)).toHaveLength(1);
  });
});

describe('applyFilters', () => {
  it('treats an empty source selection as every source', () => {
    expect(applyFilters(all, EMPTY_FILTERS, '')).toHaveLength(2);
  });

  it('isolates a single source', () => {
    expect(applyFilters(all, withFilters({ sources: ['redmine'] }), '')).toEqual([redmine]);
  });

  it('searches title, ref and project', () => {
    expect(applyFilters(all, EMPTY_FILTERS, 'alpha')).toEqual([huddle]);
    expect(applyFilters(all, EMPTY_FILTERS, '#9')).toEqual([redmine]);
    expect(applyFilters(all, EMPTY_FILTERS, 'platform')).toEqual([redmine]);
    expect(applyFilters(all, EMPTY_FILTERS, 'nothing')).toEqual([]);
  });

  it('filters by a source-specific native status', () => {
    expect(applyFilters(all, withFilters({ status: 'Feedback' }), '')).toEqual([redmine]);
  });

  it('matches assignees by source-namespaced key', () => {
    const mine = make({ key: 'huddle:2', id: '2', assignees: [{ id: 'u1', name: 'Ada' }] });
    // Same raw assignee id under a different source must not match.
    const theirs = make({
      key: 'redmine:2',
      sourceId: 'redmine',
      id: '2',
      assignees: [{ id: 'u1', name: 'Ada' }],
    });
    const result = applyFilters([mine, theirs], withFilters({ assignee: 'huddle:u1' }), '');
    expect(result).toEqual([mine]);
  });

  it('finds unassigned tickets', () => {
    const assigned = make({ key: 'huddle:2', id: '2', assignees: [{ id: 'u1', name: 'Ada' }] });
    expect(applyFilters([huddle, assigned], withFilters({ assignee: UNASSIGNED }), '')).toEqual([
      huddle,
    ]);
  });

  it('finds tickets with no priority', () => {
    const high = make({ key: 'huddle:2', id: '2', priority: { native: 'high', rank: 3 } });
    expect(applyFilters([huddle, high], withFilters({ priority: NO_PRIORITY }), '')).toEqual([
      huddle,
    ]);
    expect(applyFilters([huddle, high], withFilters({ priority: 'high' }), '')).toEqual([high]);
  });
});

describe('sortTickets', () => {
  it('sorts by most recently updated by default', () => {
    const older = make({ key: 'a', updatedAt: '2026-01-01T00:00:00.000Z' });
    const newer = make({ key: 'b', updatedAt: '2026-03-01T00:00:00.000Z' });
    expect(sortTickets([older, newer], DEFAULT_SORT).map((t) => t.key)).toEqual(['b', 'a']);
  });

  it('falls back to createdAt when a ticket was never updated', () => {
    const neverUpdated = make({
      key: 'a',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: null,
    });
    const updated = make({ key: 'b', updatedAt: '2026-02-01T00:00:00.000Z' });
    expect(sortTickets([updated, neverUpdated], DEFAULT_SORT).map((t) => t.key)).toEqual([
      'a',
      'b',
    ]);
  });

  it('keeps undated tickets last in both directions', () => {
    const undated = make({ key: 'a', createdAt: null, updatedAt: null });
    const dated = make({ key: 'b', updatedAt: '2020-01-01T00:00:00.000Z' });
    expect(sortTickets([undated, dated], { field: 'updated', direction: 'desc' })).toEqual([
      dated,
      undated,
    ]);
    expect(sortTickets([undated, dated], { field: 'updated', direction: 'asc' })).toEqual([
      dated,
      undated,
    ]);
  });

  it('sorts by priority rank across differing source vocabularies', () => {
    const huddleHigh = make({ key: 'a', priority: { native: 'critical', rank: 4 } });
    const redmineHigh = make({
      key: 'b',
      sourceId: 'redmine',
      priority: { native: 'Immediate', rank: 5 },
    });
    const none = make({ key: 'c', priority: null });
    const sorted = sortTickets([none, huddleHigh, redmineHigh], {
      field: 'priority',
      direction: 'desc',
    });
    expect(sorted.map((t) => t.key)).toEqual(['b', 'a', 'c']);
  });

  it('sorts issue refs numerically, not lexically', () => {
    const rows = [
      make({ key: 'a', ref: '#10' }),
      make({ key: 'b', ref: '#9' }),
      make({ key: 'c', ref: '#100' }),
    ];
    expect(sortTickets(rows, { field: 'ref', direction: 'asc' }).map((t) => t.key)).toEqual([
      'b',
      'a',
      'c',
    ]);
  });

  it('does not mutate the input array', () => {
    const input = [make({ key: 'a' }), make({ key: 'b' })];
    const copy = [...input];
    sortTickets(input, { field: 'title', direction: 'asc' });
    expect(input).toEqual(copy);
  });
});

describe('toggleSort', () => {
  it('flips direction when the same column is clicked again', () => {
    expect(toggleSort({ field: 'title', direction: 'asc' }, 'title')).toEqual({
      field: 'title',
      direction: 'desc',
    });
  });

  it('starts text columns ascending and dates/priority descending', () => {
    expect(toggleSort(DEFAULT_SORT, 'title').direction).toBe('asc');
    expect(toggleSort({ field: 'title', direction: 'asc' }, 'updated').direction).toBe('desc');
    expect(toggleSort({ field: 'title', direction: 'asc' }, 'priority').direction).toBe('desc');
  });
});
