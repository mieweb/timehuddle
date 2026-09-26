/**
 * Tests for the merge behaviour of useUnifiedTickets.
 *
 * The important guarantees here are the ones that are easy to regress:
 *   - sources are partitioned, so a live update to one cannot wipe another,
 *   - one failing source does not empty the list,
 *   - an unavailable source is omitted silently rather than erroring.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { AnyTicketSource, TicketSourceContext, UnifiedTicket } from './types';

const mockSources = vi.hoisted(() => ({ value: [] as AnyTicketSource[] }));

vi.mock('./registry', () => ({
  get TICKET_SOURCES() {
    return mockSources.value;
  },
  SOURCE_LABELS: {},
}));

const { useUnifiedTickets } = await import('./useUnifiedTickets');

const ctx: TicketSourceContext = {
  userId: 'u1',
  teams: [{ id: 'team-1', name: 'Platform' }],
  resolveMemberName: () => null,
};

const ticket = (key: string): UnifiedTicket =>
  ({ key, id: key, sourceId: key.split(':')[0] }) as UnifiedTicket;

function fakeSource(
  id: string,
  load: () => Promise<UnifiedTicket[]>,
  isAvailable = true,
): AnyTicketSource {
  return {
    id: id as AnyTicketSource['id'],
    label: id,
    capabilities: {
      edit: false,
      delete: false,
      assign: false,
      changeStatus: false,
      openExternal: false,
    },
    isAvailable: () => isAvailable,
    load,
  };
}

beforeEach(() => {
  mockSources.value = [];
});

describe('useUnifiedTickets', () => {
  it('merges the results of every source', async () => {
    mockSources.value = [
      fakeSource('huddle', async () => [ticket('huddle:1')]),
      fakeSource('redmine', async () => [ticket('redmine:9')]),
    ];

    const { result } = renderHook(() => useUnifiedTickets(ctx));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tickets.map((t) => t.key)).toEqual(['huddle:1', 'redmine:9']);
    expect(result.current.errors).toEqual([]);
  });

  it('keeps one source\u2019s rows when another source updates', async () => {
    mockSources.value = [
      fakeSource('huddle', async () => [ticket('huddle:1')]),
      fakeSource('redmine', async () => [ticket('redmine:9')]),
    ];

    const { result } = renderHook(() => useUnifiedTickets(ctx));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Simulates the Huddle DDP push replacing its whole subscribed set.
    act(() => result.current.setSourceItems('huddle', [ticket('huddle:2')]));

    expect(result.current.tickets.map((t) => t.key)).toEqual(['huddle:2', 'redmine:9']);
  });

  it('renders the healthy source when another fails', async () => {
    mockSources.value = [
      fakeSource('huddle', async () => [ticket('huddle:1')]),
      fakeSource('redmine', () => Promise.reject(new Error('Redmine unreachable'))),
    ];

    const { result } = renderHook(() => useUnifiedTickets(ctx));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tickets.map((t) => t.key)).toEqual(['huddle:1']);
    expect(result.current.errors).toEqual([
      { sourceId: 'redmine', message: 'Redmine unreachable' },
    ]);
  });

  it('omits an unavailable source without reporting an error', async () => {
    const load = vi.fn(async () => [ticket('redmine:9')]);
    mockSources.value = [
      fakeSource('huddle', async () => [ticket('huddle:1')]),
      fakeSource('redmine', load, false),
    ];

    const { result } = renderHook(() => useUnifiedTickets(ctx));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(load).not.toHaveBeenCalled();
    expect(result.current.tickets.map((t) => t.key)).toEqual(['huddle:1']);
    expect(result.current.errors).toEqual([]);
  });

  it('keeps the last good rows when a refetch fails', async () => {
    let shouldFail = false;
    mockSources.value = [
      fakeSource('huddle', () =>
        shouldFail ? Promise.reject(new Error('boom')) : Promise.resolve([ticket('huddle:1')]),
      ),
    ];

    const { result } = renderHook(() => useUnifiedTickets(ctx));
    await waitFor(() => expect(result.current.loading).toBe(false));

    shouldFail = true;
    act(() => result.current.refetch());

    await waitFor(() => expect(result.current.errors).toHaveLength(1));
    expect(result.current.tickets.map((t) => t.key)).toEqual(['huddle:1']);
  });
});
