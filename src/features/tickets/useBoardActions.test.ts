import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(
      message: string,
      public readonly status: number,
      public readonly code?: string,
    ) {
      super(message);
    }
  }
  return { ApiError, addMany: vi.fn(), removeMany: vi.fn() };
});
vi.mock('../../lib/api', () => ({
  ApiError: api.ApiError,
  myBoardApi: { addMany: api.addMany, removeMany: api.removeMany },
}));

const toast = vi.hoisted(() => ({ error: vi.fn(), toast: vi.fn() }));
vi.mock('@mieweb/ui', () => ({ useToast: () => toast }));

const sources = vi.hoisted(() => ({ invalidateRedmineCache: vi.fn() }));
vi.mock('./sources', () => ({
  invalidateRedmineCache: sources.invalidateRedmineCache,
  ticketRefOf: (key: string) => {
    const [sourceId, ticketId] = key.split(/:(.*)/s);
    return { sourceId, ticketId };
  },
}));

const team = vi.hoisted(() => ({ selectedTeamId: 'team1' as string | null }));
vi.mock('../../lib/TeamContext', () => ({ useTeam: () => team }));

// A Redmine issue goes on as its carrier, `huddle:carrier-<n>` (#736).
const carry = vi.hoisted(() => {
  class NoTeamError extends Error {}
  return { NoTeamError, carriedKey: vi.fn() };
});
vi.mock('./carryIssue', () => carry);

const { useBoardActions } = await import('./useBoardActions');
const { boardText } = await import('./boardStrings');
const { removalText } = await import('./ticketRemovalStrings');

const refetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  api.addMany.mockResolvedValue({ addedCount: 1 });
  api.removeMany.mockResolvedValue({ removedCount: 1 });
  team.selectedTeamId = 'team1';
  carry.carriedKey.mockImplementation(async (key: string, teamId: string | null) => {
    if (!key.startsWith('redmine:')) return key;
    if (!teamId) throw new carry.NoTeamError();
    return `huddle:carrier-${key.slice('redmine:'.length)}`;
  });
  window.addEventListener('tickets:refetch', refetch);
});
afterEach(() => {
  window.removeEventListener('tickets:refetch', refetch);
  cleanup();
});

describe('useBoardActions', () => {
  it('adds tickets by key and tells the app to look again', async () => {
    const { result } = renderHook(() => useBoardActions());

    await expect(result.current.add(['huddle:a'])).resolves.toEqual(['huddle:a']);

    expect(api.addMany).toHaveBeenCalledWith([{ sourceId: 'huddle', ticketId: 'a' }]);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(sources.invalidateRedmineCache).not.toHaveBeenCalled();
  });

  it('puts a Redmine issue on as the ticket carrying it in the selected team (#736)', async () => {
    const { result } = renderHook(() => useBoardActions());

    await expect(result.current.add(['redmine:482', 'huddle:a'])).resolves.toEqual([
      'huddle:carrier-482',
      'huddle:a',
    ]);

    expect(carry.carriedKey).toHaveBeenCalledWith('redmine:482', 'team1');
    expect(api.addMany).toHaveBeenCalledWith([
      { sourceId: 'huddle', ticketId: 'carrier-482' },
      { sourceId: 'huddle', ticketId: 'a' },
    ]);
  });

  it('adds nothing, and says why, when no team is selected for a Redmine issue', async () => {
    team.selectedTeamId = null;
    const { result } = renderHook(() => useBoardActions());

    await expect(result.current.add(['redmine:482'])).resolves.toBeNull();

    expect(toast.error).toHaveBeenCalledWith(boardText.noTeam);
    expect(api.addMany).not.toHaveBeenCalled();
  });

  it('adds the rest when one issue cannot be carried', async () => {
    carry.carriedKey.mockImplementation(async (key: string) => {
      if (key === 'redmine:9') throw new api.ApiError('gone', 404, 'issue-unavailable');
      return key.startsWith('redmine:') ? `huddle:carrier-${key.slice(8)}` : key;
    });
    const { result } = renderHook(() => useBoardActions());

    await expect(result.current.add(['redmine:9', 'redmine:482'])).resolves.toEqual([
      'huddle:carrier-482',
    ]);

    expect(toast.error).toHaveBeenCalledWith(boardText.carryFailed(1));
  });

  it('drops the cached Redmine issues when a Redmine issue joins or leaves the board', async () => {
    const { result } = renderHook(() => useBoardActions());

    await result.current.add(['redmine:482']);
    await result.current.remove(['huddle:a', 'redmine:482']);

    expect(sources.invalidateRedmineCache).toHaveBeenCalledTimes(2);
  });

  it('shows the server\u2019s own message when the board is full', async () => {
    api.addMany.mockRejectedValue(
      new api.ApiError('My Board holds at most 500 tickets.', 400, 'board-full'),
    );
    const { result } = renderHook(() => useBoardActions());

    await expect(result.current.add(['huddle:a'])).resolves.toBeNull();

    expect(toast.error).toHaveBeenCalledWith('My Board holds at most 500 tickets.');
    expect(refetch).not.toHaveBeenCalled();
  });

  it('reports any other failed add or remove in its own words', async () => {
    api.addMany.mockRejectedValue(new Error('offline'));
    api.removeMany.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useBoardActions());

    await expect(result.current.add(['huddle:a'])).resolves.toBeNull();
    await expect(result.current.remove(['huddle:a'])).resolves.toBe(false);

    expect(toast.error).toHaveBeenNthCalledWith(1, removalText.boardAddFailed);
    expect(toast.error).toHaveBeenNthCalledWith(2, removalText.boardRemoveFailed);
  });

  it('removes quietly by default, as the bulk bar does', async () => {
    const { result } = renderHook(() => useBoardActions());

    await expect(result.current.remove(['huddle:a'])).resolves.toBe(true);

    expect(api.removeMany).toHaveBeenCalledWith([{ sourceId: 'huddle', ticketId: 'a' }]);
    expect(toast.toast).not.toHaveBeenCalled();
  });

  it('confirms a named removal with an Undo that puts the ticket back', async () => {
    const { result } = renderHook(() => useBoardActions());

    await result.current.remove(['huddle:a'], 'Fix login');

    const shown = toast.toast.mock.calls[0][0];
    expect(shown.message).toBe(boardText.removed('Fix login'));
    expect(shown.action.label).toBe(boardText.undo);

    shown.action.onClick();
    await vi.waitFor(() =>
      expect(api.addMany).toHaveBeenCalledWith([{ sourceId: 'huddle', ticketId: 'a' }]),
    );
  });
});
