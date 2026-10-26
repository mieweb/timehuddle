import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ClockEvent } from '../../lib/api';
import { useRecentSessions } from './useRecentSessions';

const getRecentSessions = vi.fn<() => Promise<ClockEvent[]>>();
vi.mock('../../lib/api', () => ({ clockApi: { getRecentSessions: () => getRecentSessions() } }));

afterEach(() => {
  cleanup();
  getRecentSessions.mockReset();
});

const NOW = new Date(2026, 9, 12, 12, 0, 0).getTime();

function event(overrides: Partial<ClockEvent> & { startTime: number }): ClockEvent {
  return {
    id: `event-${overrides.startTime}`,
    userId: 'user-1',
    teamId: 'team-a',
    accumulatedTime: 0,
    endTime: null,
    ...overrides,
  };
}

describe('useRecentSessions totals', () => {
  it('adds the running shift at full precision, without rounding it down first', async () => {
    // 90s finished + 90s running is 3 minutes. Rounding the running part down
    // to a whole minute first would show 2m until clock-out, then jump to 3m.
    const finishedStart = NOW - 3 * 60 * 60 * 1000;
    getRecentSessions.mockResolvedValue([
      event({ startTime: finishedStart, endTime: finishedStart + 90_000, workSeconds: 90 }),
    ]);
    const running = event({ id: 'running', startTime: NOW - 90_000 });

    const { result } = renderHook(() => useRecentSessions('team-a', running, NOW));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.todaySeconds).toBe(180);
    expect(result.current.last7DaysSeconds).toBe(180);
  });

  it("never counts another team's sessions, even before a team switch's fetch lands", async () => {
    getRecentSessions.mockResolvedValue([
      event({ startTime: NOW - 60 * 60 * 1000, endTime: NOW - 30 * 60 * 1000, workSeconds: 1800 }),
    ]);
    const { result, rerender } = renderHook(({ teamId }) => useRecentSessions(teamId, null, NOW), {
      initialProps: { teamId: 'team-a' },
    });
    await waitFor(() => expect(result.current.todaySeconds).toBe(1800));

    getRecentSessions.mockReturnValue(new Promise(() => {})); // team B's fetch never lands
    rerender({ teamId: 'team-b' });

    expect(result.current.todaySeconds).toBe(0);
    expect(result.current.sessions).toEqual([]);
  });

  it('keeps the last loaded history when a refresh fails', async () => {
    getRecentSessions.mockResolvedValue([
      event({ startTime: NOW - 60 * 60 * 1000, endTime: NOW - 30 * 60 * 1000, workSeconds: 1800 }),
    ]);
    const { result, rerender } = renderHook(
      ({ active }) => useRecentSessions('team-a', active, NOW),
      { initialProps: { active: null as ClockEvent | null } },
    );
    await waitFor(() => expect(result.current.todaySeconds).toBe(1800));

    // Clocking in triggers a refresh; it fails, but the 30m already loaded stays.
    getRecentSessions.mockRejectedValue(new Error('network'));
    rerender({ active: event({ id: 'running', startTime: NOW - 60_000 }) });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.todaySeconds).toBe(1860);
  });

  it('keeps a just-finished shift in the totals until its record loads', async () => {
    getRecentSessions.mockResolvedValue([]);
    const running = event({ id: 'shift', startTime: NOW - 3 * 60 * 60 * 1000 });
    const { result, rerender } = renderHook(
      ({ active }) => useRecentSessions('team-a', active, NOW),
      { initialProps: { active: running as ClockEvent | null } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.todaySeconds).toBe(3 * 3600);

    // Clocking out: the reload is still in flight, then fails. 3h stays.
    let failReload!: (e: Error) => void;
    getRecentSessions.mockReturnValue(new Promise((_, reject) => (failReload = reject)));
    rerender({ active: null });
    expect(result.current.todaySeconds).toBe(3 * 3600);
    failReload(new Error('network'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.todaySeconds).toBe(3 * 3600);

    // Once a reload includes the finished shift, it is counted once, not twice.
    getRecentSessions.mockResolvedValue([{ ...running, endTime: NOW, workSeconds: 3 * 3600 }]);
    rerender({ active: running });
    rerender({ active: null });
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));
    expect(result.current.todaySeconds).toBe(3 * 3600);
  });
});
