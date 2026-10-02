import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { attachmentApi } from '@lib/api';
import { useTicketVideos } from './useTicketVideos';

vi.mock('@lib/api', () => ({
  attachmentApi: { list: vi.fn() },
}));

const mockList = vi.mocked(attachmentApi.list);

function videoAttachment(id: string) {
  return { id, type: 'video', url: `/pulsevault/artifacts/${id}`, title: id };
}

/** A promise plus the handle to settle it, so a request can be held in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useTicketVideos', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports no videos and no loading without a ticket', () => {
    const { result } = renderHook(() => useTicketVideos(undefined));
    expect(result.current).toEqual({ videos: [], loading: false, error: null });
    expect(mockList).not.toHaveBeenCalled();
  });

  it('loads the selected ticket’s videos', async () => {
    mockList.mockResolvedValue([
      videoAttachment('vid-a'),
      { id: 'doc-1', type: 'file', url: '/uploads/a.pdf', title: 'a.pdf' },
    ] as never);

    const { result } = renderHook(() => useTicketVideos('ticket-a'));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.videos.map((v) => v.id)).toEqual(['vid-a']);
  });

  it('never reports ticket A’s videos while ticket B is still loading', async () => {
    const a = deferred<unknown[]>();
    const b = deferred<unknown[]>();
    mockList.mockImplementationOnce(() => a.promise as never);
    mockList.mockImplementationOnce(() => b.promise as never);

    const { result, rerender } = renderHook(({ id }) => useTicketVideos(id), {
      initialProps: { id: 'ticket-a' as string | undefined },
    });

    a.resolve([videoAttachment('vid-a')]);
    await waitFor(() => expect(result.current.videos.map((v) => v.id)).toEqual(['vid-a']));

    // Switch to B while B's request is still in flight.
    rerender({ id: 'ticket-b' });
    expect(result.current.videos).toEqual([]);
    expect(result.current.loading).toBe(true);

    b.resolve([videoAttachment('vid-b')]);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.videos.map((v) => v.id)).toEqual(['vid-b']);
  });

  it('does not adopt a late response from a ticket that is no longer selected', async () => {
    const a = deferred<unknown[]>();
    const b = deferred<unknown[]>();
    mockList.mockImplementationOnce(() => a.promise as never);
    mockList.mockImplementationOnce(() => b.promise as never);

    const { result, rerender } = renderHook(({ id }) => useTicketVideos(id), {
      initialProps: { id: 'ticket-a' as string | undefined },
    });
    rerender({ id: 'ticket-b' });

    // A resolves after the switch — out-of-order responses must not win.
    a.resolve([videoAttachment('vid-a')]);
    b.resolve([videoAttachment('vid-b')]);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.videos.map((v) => v.id)).toEqual(['vid-b']);
  });

  it('surfaces an error instead of silently reporting no videos', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockList.mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useTicketVideos('ticket-a'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.videos).toEqual([]);
  });

  it('clears back to idle when the ticket is deselected', async () => {
    mockList.mockResolvedValue([videoAttachment('vid-a')] as never);
    const { result, rerender } = renderHook(({ id }) => useTicketVideos(id), {
      initialProps: { id: 'ticket-a' as string | undefined },
    });
    await waitFor(() => expect(result.current.videos).toHaveLength(1));

    rerender({ id: undefined });
    expect(result.current).toEqual({ videos: [], loading: false, error: null });
  });

  it('reloads, not reuses, a ticket that is deselected and picked again', async () => {
    const again = deferred<unknown[]>();
    mockList.mockResolvedValueOnce([videoAttachment('vid-a')] as never);
    mockList.mockImplementationOnce(() => again.promise as never);
    const { result, rerender } = renderHook(({ id }) => useTicketVideos(id), {
      initialProps: { id: 'ticket-a' as string | undefined },
    });
    await waitFor(() => expect(result.current.videos).toHaveLength(1));

    rerender({ id: undefined });
    rerender({ id: 'ticket-a' });
    expect(result.current).toEqual({ videos: [], loading: true, error: null });

    again.resolve([]);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.videos).toEqual([]);
  });
});
