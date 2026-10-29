import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { notificationPrefsApi, type NotificationPrefs } from '../../lib/api';
import { useNotificationPrefs } from './useNotificationPrefs';

vi.mock('../../lib/api', () => ({
  notificationPrefsApi: { get: vi.fn(), update: vi.fn() },
}));

const api = vi.mocked(notificationPrefsApi);
const TEAM = 'team-1';
const loaded: NotificationPrefs = {
  events: {},
  teams: {},
  quiet: {
    holdOffShift: false,
    snoozeUntil: null,
    snoozeUntilClockIn: false,
    skipWhileViewing: true,
  },
  locked: [],
};

async function renderLoaded() {
  api.get.mockResolvedValue(loaded);
  const hook = renderHook(() => useNotificationPrefs());
  await waitFor(() => expect(hook.result.current.prefs).not.toBeNull());
  return hook;
}

describe('useNotificationPrefs saves', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends saves one at a time, in the order they were made', async () => {
    const order: string[] = [];
    let finishFirst!: () => void;
    api.update
      .mockImplementationOnce(async (patch) => {
        order.push(`start ${patch.teams?.[TEAM]}`);
        await new Promise<void>((resolve) => (finishFirst = resolve));
        order.push('end all');
        return loaded;
      })
      .mockImplementationOnce(async (patch) => {
        order.push(`start ${patch.teams?.[TEAM]}`);
        return loaded;
      });
    const { result } = await renderLoaded();

    act(() => result.current.setTeamLevel(TEAM, 'all'));
    act(() => result.current.setTeamLevel(TEAM, 'mute'));
    await waitFor(() => expect(order).toEqual(['start all']));
    finishFirst();
    await waitFor(() => expect(order).toEqual(['start all', 'end all', 'start mute']));
  });

  it("doesn't let an older failed save undo a newer choice", async () => {
    let failFirst!: () => void;
    api.update
      .mockImplementationOnce(
        () => new Promise((_, reject) => (failFirst = () => reject(new Error('offline')))),
      )
      .mockResolvedValueOnce(loaded);
    const { result } = await renderLoaded();

    act(() => result.current.setTeamLevel(TEAM, 'all'));
    act(() => result.current.setTeamLevel(TEAM, 'mute'));
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    await act(async () => failFirst());
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(2));

    expect(result.current.teamLevel(TEAM)).toBe('mute');
    expect(result.current.error).toBeNull();
  });

  it('puts the choice back and reports it when the newest save fails', async () => {
    api.update.mockRejectedValueOnce(new Error('offline'));
    const { result } = await renderLoaded();

    act(() => result.current.setTeamLevel(TEAM, 'mute'));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.teamLevel(TEAM)).toBe('mentions');
  });
});
