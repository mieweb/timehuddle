import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { huddleApi } from './api';
import { getDdpClient } from './ddp';
import { useSessionPost } from './useSessionPost';

vi.mock('./api', () => ({
  huddleApi: { getMyPostForSession: vi.fn() },
}));

vi.mock('./ddp', () => ({
  getDdpClient: vi.fn(),
}));

const mockGetMyPostForSession = vi.mocked(huddleApi.getMyPostForSession);
const mockGetDdpClient = vi.mocked(getDdpClient);

function livePosts(docs: Record<string, unknown>[]) {
  mockGetDdpClient.mockReturnValue({
    docs: vi.fn(() => docs),
    subscribe: vi.fn(() => vi.fn()),
    onCollectionChange: vi.fn(() => vi.fn()),
  } as unknown as ReturnType<typeof getDdpClient>);
}

function post(id: string, createdAt: string, extra: Record<string, unknown> = {}) {
  return { _id: id, teamId: 'team1', clockEventId: 'shift1', createdAt, wrapUpAt: null, ...extra };
}

describe('useSessionPost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMyPostForSession.mockResolvedValue(null);
  });

  it('takes the earliest live post as the plan', async () => {
    livePosts([post('later', '2026-11-10T10:00:00Z'), post('plan', '2026-11-10T09:00:00Z')]);
    const { result } = renderHook(() => useSessionPost('team1', 'shift1'));
    await waitFor(() => expect(result.current.sessionPost?.id).toBe('plan'));
  });

  it('never takes an update that joined the session for its plan', async () => {
    // A shift with no plan: its only post is an update, so the wrap-up editor
    // must fall back to its no-plan path rather than write onto the update.
    livePosts([post('update', '2026-11-10T09:00:00Z', { sessionUpdate: true })]);
    const { result } = renderHook(() => useSessionPost('team1', 'shift1'));
    await waitFor(() => expect(mockGetMyPostForSession).toHaveBeenCalled());
    expect(result.current.sessionPost).toBeNull();
  });

  it('skips an earlier update for the plan posted after it', async () => {
    livePosts([
      post('update', '2026-11-10T09:00:00Z', { sessionUpdate: true }),
      post('plan', '2026-11-10T09:30:00Z', { sessionUpdate: false }),
    ]);
    const { result } = renderHook(() => useSessionPost('team1', 'shift1'));
    await waitFor(() => expect(result.current.sessionPost?.id).toBe('plan'));
  });
});
