import { describe, expect, it } from 'vitest';

import type { SessionPlan } from '../../lib/api';
import type { RunningTicket } from '../../lib/useRunningTicket';
import { todayPlanRows } from './todayPlanRows';

const plan: SessionPlan = {
  clockEventId: 'ev1',
  initialized: true,
  items: [
    {
      id: 'a',
      ticketId: 't1',
      title: 'TH-1: Alpha',
      checked: false,
      seconds: 600,
      runningSince: 5_000,
    },
    {
      id: 'b',
      ticketId: 't2',
      title: 'TH-2: Bravo',
      checked: true,
      seconds: 60,
      runningSince: null,
    },
    { id: 'c', text: 'Lunch', checked: false },
  ],
};
const running = (key: string, startTime: number) =>
  ({
    key,
    startTime,
    source: 'huddle',
    id: key.slice(7),
    title: '',
    url: null,
    sessionId: 's',
  }) as RunningTicket;

describe('todayPlanRows (#886)', () => {
  it('keeps each plan ticket’s time this session, for its paused pill', () => {
    expect([...todayPlanRows(plan, null).seconds]).toEqual([
      ['huddle:t1', 600],
      ['huddle:t2', 60],
    ]);
  });

  it('counts a resumed plan ticket’s timer from its earlier stints this session', () => {
    expect(todayPlanRows(plan, running('huddle:t1', 5_000)).running).toEqual({
      key: 'huddle:t1',
      since: 5_000 - 600_000,
    });
    expect(todayPlanRows(plan, running('huddle:t9', 5_000)).running).toEqual({
      key: 'huddle:t9',
      since: 5_000,
    });
  });
});
