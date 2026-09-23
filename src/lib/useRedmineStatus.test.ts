import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { redmineApi, type RedmineStatus } from './api';
import { notifyRedmineChanged, REDMINE_CHANGED, useRedmineStatus } from './useRedmineStatus';
import { useSession } from './useSession';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('./api', () => ({
  redmineApi: { status: vi.fn() },
}));

vi.mock('./useSession', () => ({
  useSession: vi.fn(),
}));

const mockStatus = vi.mocked(redmineApi.status);
const mockUseSession = vi.mocked(useSession);

const CONNECTED: RedmineStatus = {
  connected: true,
  redmineUserId: 8,
  redmineLogin: 'priya.patel',
  baseUrl: 'https://redmine.example.test',
};

function signedInAs(userId: string | null) {
  mockUseSession.mockReturnValue({
    user: userId ? { id: userId } : null,
  } as unknown as ReturnType<typeof useSession>);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useRedmineStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signedInAs('u1');
    mockStatus.mockResolvedValue({ connected: false });
  });

  // This project runs vitest without `globals`, so Testing Library's automatic
  // cleanup never registers. Without an explicit unmount every hook from every
  // earlier test stays mounted — and each one keeps its `redmine:changed`
  // listener, so one dispatch would fan out across all of them.
  afterEach(cleanup);

  it('fetches the status once the user is known', async () => {
    mockStatus.mockResolvedValue(CONNECTED);

    const { result } = renderHook(() => useRedmineStatus());

    await waitFor(() => expect(result.current).toEqual(CONNECTED));
    expect(mockStatus).toHaveBeenCalledTimes(1);
  });

  it('does not fetch while no one is signed in', async () => {
    signedInAs(null);

    const { result } = renderHook(() => useRedmineStatus());

    await waitFor(() => expect(result.current).toBeNull());
    expect(mockStatus).not.toHaveBeenCalled();
  });

  it('leaves the status null when the fetch fails', async () => {
    // `null` is "unknown", which callers render as nothing — never as a
    // confident "not connected".
    mockStatus.mockRejectedValue(new Error('unreachable'));

    const { result } = renderHook(() => useRedmineStatus());

    await waitFor(() => expect(mockStatus).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it('applies a broadcast status without fetching again', async () => {
    const { result } = renderHook(() => useRedmineStatus());
    await waitFor(() => expect(result.current).toEqual({ connected: false }));
    mockStatus.mockClear();

    act(() => notifyRedmineChanged(CONNECTED));

    expect(result.current).toEqual(CONNECTED);
    expect(mockStatus).not.toHaveBeenCalled();
  });

  it('refetches when the broadcast carries no usable payload', async () => {
    const { result } = renderHook(() => useRedmineStatus());
    await waitFor(() => expect(result.current).toEqual({ connected: false }));
    mockStatus.mockClear();
    mockStatus.mockResolvedValue(CONNECTED);

    act(() => {
      window.dispatchEvent(new CustomEvent(REDMINE_CHANGED));
    });

    await waitFor(() => expect(result.current).toEqual(CONNECTED));
    expect(mockStatus).toHaveBeenCalledTimes(1);
  });

  it('picks up a disconnect broadcast', async () => {
    mockStatus.mockResolvedValue(CONNECTED);
    const { result } = renderHook(() => useRedmineStatus());
    await waitFor(() => expect(result.current).toEqual(CONNECTED));

    act(() => notifyRedmineChanged({ connected: false }));

    expect(result.current).toEqual({ connected: false });
  });

  it('refetches for a different user, so one session cannot inherit another', async () => {
    // Signing out does not reload the page, so the user id has to be a dep.
    mockStatus.mockResolvedValue(CONNECTED);
    const { result, rerender } = renderHook(() => useRedmineStatus());
    await waitFor(() => expect(result.current).toEqual(CONNECTED));

    signedInAs('u2');
    mockStatus.mockResolvedValue({ connected: false });
    rerender();

    await waitFor(() => expect(result.current).toEqual({ connected: false }));
    expect(mockStatus).toHaveBeenCalledTimes(2);
  });

  it('stops listening once unmounted', async () => {
    const { result, unmount } = renderHook(() => useRedmineStatus());
    await waitFor(() => expect(result.current).toEqual({ connected: false }));

    unmount();

    // No act() wrapper: nothing should re-render, and React would warn if it did.
    expect(() => notifyRedmineChanged(CONNECTED)).not.toThrow();
  });
});
