import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { timerApi } from './api';
import { getDdpClient } from './ddp';
import { useRunningTicket } from './useRunningTicket';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('./api', () => ({
  timerApi: {
    getRunning: vi.fn(),
    getDay: vi.fn(),
    getToday: vi.fn(),
  },
}));

vi.mock('./ddp', () => ({
  getDdpClient: vi.fn(),
}));

const mockGetRunning = vi.mocked(timerApi.getRunning);
const mockGetDay = vi.mocked(timerApi.getDay);
const mockGetToday = vi.mocked(timerApi.getToday);
const mockGetDdpClient = vi.mocked(getDdpClient);

const mockOffChange = vi.fn();
const mockUnsubscribe = vi.fn();

function setupDdp() {
  mockGetDdpClient.mockReturnValue({
    onCollectionChange: vi.fn(() => mockOffChange),
    subscribe: vi.fn(() => mockUnsubscribe),
  } as unknown as ReturnType<typeof getDdpClient>);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useRunningTicket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    setupDdp();
  });

  it('returns null when there is no resume token', async () => {
    const { result } = renderHook(() => useRunningTicket(true));
    await waitFor(() => {
      expect(result.current).toBeNull();
    });
    expect(mockGetRunning).not.toHaveBeenCalled();
  });

  it('returns null when getRunning finds no open session', async () => {
    localStorage.setItem('meteor_resume_token', 'tok');
    mockGetRunning.mockResolvedValue(null);

    const { result } = renderHook(() => useRunningTicket(true));
    await waitFor(() => {
      expect(result.current).toBeNull();
    });
    expect(mockGetRunning).toHaveBeenCalledOnce();
    expect(mockGetDay).not.toHaveBeenCalled();
  });

  it('loads the work-item day from the session date (overnight timers)', async () => {
    localStorage.setItem('meteor_resume_token', 'tok');
    mockGetRunning.mockResolvedValue({
      id: 'sess1',
      workItemId: 'wi1',
      userId: 'u1',
      date: '2026-09-03',
      startTime: Date.now() - 3_600_000,
      endTime: null,
      createdAt: '2026-09-03T20:00:00.000Z',
    });
    mockGetDay.mockResolvedValue([
      {
        entry: {
          id: 'wi1',
          userId: 'u1',
          ticketId: 'tkt1',
          displayTitle: 'Overnight ticket',
          date: '2026-09-03',
          createdAt: '2026-09-03T20:00:00.000Z',
        },
        sessions: [],
      },
    ]);

    const { result } = renderHook(() => useRunningTicket(true));
    await waitFor(() => {
      expect(result.current).toEqual({
        id: 'tkt1',
        title: 'Overnight ticket',
        sessionId: 'sess1',
      });
    });
    expect(mockGetDay).toHaveBeenCalledWith('2026-09-03');
    expect(mockGetToday).not.toHaveBeenCalled();
  });

  it('clears state when the API throws', async () => {
    localStorage.setItem('meteor_resume_token', 'tok');
    mockGetRunning.mockRejectedValue(new Error('network'));

    const { result } = renderHook(() => useRunningTicket(true));
    await waitFor(() => {
      expect(result.current).toBeNull();
    });
  });

  it('skips fetch and returns null when enabled is false', async () => {
    localStorage.setItem('meteor_resume_token', 'tok');
    const { result } = renderHook(() => useRunningTicket(false));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current).toBeNull();
    expect(mockGetRunning).not.toHaveBeenCalled();
    expect(mockGetDdpClient).not.toHaveBeenCalled();
  });
});
