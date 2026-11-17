import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock('../../../lib/api', () => ({ sourcesApi: { search: api.search } }));

const { useSourceSearch } = await import('./useSourceSearch');

/** One server's answer, naming the query it answers. */
const answerFor = (query: string) => ({
  servers: [
    {
      host: 'other.example.com',
      prefix: 'OT',
      type: 'redmine',
      failed: false,
      issues: [{ id: query }],
    },
  ],
});

/** A search the test answers when it chooses, keyed by its query. */
function deferredSearches() {
  const pending = new Map<string, (value: unknown) => void>();
  api.search.mockImplementation(
    (query: string) => new Promise((resolve) => pending.set(query, resolve)),
  );
  return (query: string) => pending.get(query)!(answerFor(query));
}

beforeEach(() => {
  api.search.mockReset();
});
afterEach(cleanup);

describe('useSourceSearch', () => {
  it('keeps the latest query’s answer when an older one arrives after it', async () => {
    const answer = deferredSearches();
    const { result, rerender } = renderHook(({ query }) => useSourceSearch('user-1', query), {
      initialProps: { query: '#12' },
    });
    await waitFor(() => expect(api.search).toHaveBeenCalledWith('#12'));
    rerender({ query: '#34' });
    await waitFor(() => expect(api.search).toHaveBeenCalledWith('#34'));

    await act(async () => answer('#34'));
    await act(async () => answer('#12'));

    expect(result.current.servers[0].issues).toEqual([{ id: '#34' }]);
    expect(result.current.settled).toBe(true);
  });

  it('asks nothing for a member who isn’t signed in', () => {
    renderHook(() => useSourceSearch(null, '#12'));
    expect(api.search).not.toHaveBeenCalled();
  });
});
