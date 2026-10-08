import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../lib/api', () => ({ myBoardApi: { list: api.list } }));

const { useMyBoardKeys } = await import('./useMyBoardKeys');

const entry = (ticketId: string, unavailable = false) => ({
  sourceId: 'huddle',
  ticketId,
  addedAt: '2026-10-06T00:00:00Z',
  ...(unavailable ? { unavailable } : {}),
});

/** A read that answers only when told to. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => api.list.mockReset());
// Unmount between tests: a hook left mounted still answers `tickets:refetch`.
afterEach(cleanup);

describe('useMyBoardKeys', () => {
  it('loads the board as keys, with the entries the user can no longer see', async () => {
    api.list.mockResolvedValue([entry('a'), entry('b', true)]);
    const { result } = renderHook(() => useMyBoardKeys('u1'));

    await waitFor(() => expect(result.current.boardKeys.size).toBe(2));
    expect([...result.current.boardKeys]).toEqual(['huddle:a', 'huddle:b']);
    expect([...result.current.unavailableHuddleKeys]).toEqual(['huddle:b']);
  });

  it('empties the board as soon as the user changes, then loads the new one', async () => {
    const second = deferred<ReturnType<typeof entry>[]>();
    api.list.mockResolvedValueOnce([entry('a')]).mockReturnValueOnce(second.promise);

    const { result, rerender } = renderHook(({ userId }) => useMyBoardKeys(userId), {
      initialProps: { userId: 'u1' },
    });
    await waitFor(() => expect(result.current.boardKeys.size).toBe(1));

    rerender({ userId: 'u2' });
    expect(result.current.boardKeys.size).toBe(0);

    await act(async () => second.resolve([entry('z')]));
    expect([...result.current.boardKeys]).toEqual(['huddle:z']);
  });

  it('says it has not loaded until the first read answers, and again for a new user', async () => {
    const first = deferred<ReturnType<typeof entry>[]>();
    const second = deferred<ReturnType<typeof entry>[]>();
    api.list.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const { result, rerender } = renderHook(({ userId }) => useMyBoardKeys(userId), {
      initialProps: { userId: 'u1' },
    });
    expect(result.current.boardLoaded).toBe(false);
    await act(async () => first.resolve([]));
    // Loaded and empty: now "nothing on it" is a fact.
    expect(result.current.boardLoaded).toBe(true);
    expect(result.current.boardKnown).toBe(true);

    rerender({ userId: 'u2' });
    expect(result.current.boardLoaded).toBe(false);
    await act(async () => second.resolve([entry('z')]));
    expect(result.current.boardLoaded).toBe(true);
  });

  it('counts a failed first read as answered, so the page does not wait forever', async () => {
    api.list.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useMyBoardKeys('u1'));
    await waitFor(() => expect(result.current.boardLoaded).toBe(true));
    expect(result.current.boardKeys.size).toBe(0);
    // Answered, but not known: an empty board here is not a fact to act on.
    expect(result.current.boardKnown).toBe(false);
  });

  it('knows the board once a later read succeeds', async () => {
    api.list.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([entry('a')]);
    const { result } = renderHook(() => useMyBoardKeys('u1'));
    await waitFor(() => expect(result.current.boardLoaded).toBe(true));
    expect(result.current.boardKnown).toBe(false);

    act(() => result.current.loadBoard());

    await waitFor(() => expect(result.current.boardKnown).toBe(true));
    expect([...result.current.boardKeys]).toEqual(['huddle:a']);
  });

  it('drops an answer that was asked for the previous user', async () => {
    const first = deferred<ReturnType<typeof entry>[]>();
    api.list.mockReturnValueOnce(first.promise).mockResolvedValueOnce([entry('z')]);

    const { result, rerender } = renderHook(({ userId }) => useMyBoardKeys(userId), {
      initialProps: { userId: 'u1' },
    });
    rerender({ userId: 'u2' });
    await waitFor(() => expect([...result.current.boardKeys]).toEqual(['huddle:z']));

    // The first user's board arrives late and must not replace the second's.
    await act(async () => first.resolve([entry('a')]));
    expect([...result.current.boardKeys]).toEqual(['huddle:z']);
  });

  it('keeps the board as it was when a reload fails', async () => {
    api.list.mockResolvedValueOnce([entry('a')]).mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useMyBoardKeys('u1'));
    await waitFor(() => expect(result.current.boardKeys.size).toBe(1));

    await act(async () => result.current.loadBoard());
    expect([...result.current.boardKeys]).toEqual(['huddle:a']);
  });

  it('reloads when something asks the tickets to refetch', async () => {
    api.list.mockResolvedValue([entry('a')]);
    renderHook(() => useMyBoardKeys('u1'));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(1));

    act(() => void window.dispatchEvent(new Event('tickets:refetch')));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });
});
