/**
 * Today's plan as My Board rows see it (M4, #886): which tickets are in the
 * plan of the session you're clocked in to, whether each is checked off, and
 * which one is running since when. TicketsPage provides it; a row reads its
 * own entry, so the list between them needs no extra props.
 */
import { createContext, useContext } from 'react';

import type { SessionPlan } from '../../lib/api';
import type { RunningTicket } from '../../lib/useRunningTicket';
import { ticketKey } from './sources';

export interface TodayPlanRow {
  /** In today's plan: whether it's checked off. Null when it isn't in the plan. */
  checked: boolean | null;
  /** When its time this session would have started had it run unbroken, epoch ms; null when it isn't running. */
  runningSince: number | null;
}

export interface TodayPlanRows {
  /** By `${sourceId}:${id}`, as `UnifiedTicket.key`. */
  planned: ReadonlyMap<string, boolean>;
  running: { key: string; since: number } | null;
}

/**
 * The rows' view of today's plan and the running timer. A plan ticket's timer
 * counts from its earlier stints this session too, as the Clock page's does:
 * coming back to a ticket resumes its time.
 */
export function todayPlanRows(
  plan: SessionPlan | null,
  running: RunningTicket | null,
): TodayPlanRows {
  const planned = new Map<string, boolean>();
  const earlierSeconds = new Map<string, number>();
  for (const item of plan?.items ?? []) {
    if (!('ticketId' in item)) continue;
    const key = ticketKey('huddle', item.ticketId);
    planned.set(key, item.checked);
    earlierSeconds.set(key, item.seconds);
  }
  if (!running) return { planned, running: null };
  const earlier = (earlierSeconds.get(running.key) ?? 0) * 1000;
  return { planned, running: { key: running.key, since: running.startTime - earlier } };
}

const TodayPlanRowsContext = createContext<TodayPlanRows | null>(null);

export const TodayPlanRowsProvider = TodayPlanRowsContext.Provider;

export function useTodayPlanRow(key: string): TodayPlanRow {
  const rows = useContext(TodayPlanRowsContext);
  return {
    checked: rows?.planned.get(key) ?? null,
    runningSince: rows?.running?.key === key ? rows.running.since : null,
  };
}
