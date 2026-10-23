import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ClockEvent } from '../../lib/api';
import { useRecentSessions } from './useRecentSessions';

const getEvents = vi.fn<() => Promise<ClockEvent[]>>();
vi.mock('../../lib/api', () => ({ clockApi: { getEvents: () => getEvents() } }));

afterEach(() => {
  cleanup();
  getEvents.mockReset();
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
    getEvents.mockResolvedValue([
      event({ startTime: finishedStart, endTime: finishedStart + 90_000, workSeconds: 90 }),
    ]);
    const running = event({ id: 'running', startTime: NOW - 90_000 });

    const { result } = renderHook(() => useRecentSessions('team-a', running, NOW));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.todaySeconds).toBe(180);
    expect(result.current.last7DaysSeconds).toBe(180);
  });

  it("never counts another team's sessions, even before a team switch's fetch lands", async () => {
    getEvents.mockResolvedValue([
      event({ startTime: NOW - 60 * 60 * 1000, endTime: NOW - 30 * 60 * 1000, workSeconds: 1800 }),
    ]);
    const { result, rerender } = renderHook(({ teamId }) => useRecentSessions(teamId, null, NOW), {
      initialProps: { teamId: 'team-a' },
    });
    await waitFor(() => expect(result.current.todaySeconds).toBe(1800));

    getEvents.mockReturnValue(new Promise(() => {})); // team B's fetch never lands
    rerender({ teamId: 'team-b' });

    expect(result.current.todaySeconds).toBe(0);
    expect(result.current.sessions).toEqual([]);
  });
});
