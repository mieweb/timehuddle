/**
 * useSessionPlan — today's plan on the signed-in user's open clock session
 * (M4, #886): its items, whether each is checked off, and each ticket's time
 * this session. The Clock page and My Board both read it here, so they show
 * the same state.
 *
 * It re-reads when the session's stored plan changes (live over DDP), when a
 * timer starts or stops — in this app or on another device (touch and go
 * moves checks on the server, and the running ticket's time moves with it) —
 * and when another view changes the plan. The server starts a session's plan
 * from its plan post the first time it's read. Every change made here is
 * announced in Huddle by the server, so the feed is asked to re-read too.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { clockApi, type SessionPlan } from '../../lib/api';
import { getDdpClient } from '../../lib/ddp';
import { requestHuddleRefresh } from '../../lib/huddleRefresh';
import { useTeam } from '../../lib/TeamContext';
import type { PlanItemInput } from '../huddle/planItems';

const PLAN_CHANGED = 'plan:changed';
const REFETCH_EVENTS = ['tickets:refetch', 'work:refetch'] as const;

export interface SessionPlanState {
  /** The team of the session the plan is for; null while clocked out. */
  teamId: string | null;
  /** Null while clocked out, or before the first read. */
  plan: SessionPlan | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  /** Replace the plan's items (an edit). */
  setItems: (items: PlanItemInput[]) => Promise<void>;
  /** Check an item off by hand, or uncheck it. */
  setChecked: (itemId: string, checked: boolean) => Promise<void>;
}

export function useSessionPlan(): SessionPlanState {
  const { activeClockEvent } = useTeam();
  const teamId = activeClockEvent && !activeClockEvent.endTime ? activeClockEvent.teamId : null;
  const eventId = activeClockEvent?.id ?? null;
  const storedKey = JSON.stringify(activeClockEvent?.planItems ?? null);
  const self = useId();

  const [plan, setPlan] = useState<SessionPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  // Only the latest read lands: an older one finishing late would put back a stale plan.
  const readRef = useRef(0);

  const refetch = useCallback(async () => {
    const read = ++readRef.current;
    if (!teamId) {
      setPlan(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const next = await clockApi.getPlan(teamId);
      if (read !== readRef.current) return;
      setPlan(next);
      setError(null);
    } catch (err) {
      if (read !== readRef.current) return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (read === readRef.current) setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    void refetch();
  }, [refetch, eventId, storedKey]);

  // A timer started or stopped anywhere, this device or another: the server
  // has moved checks and times, which the stored plan alone may not show.
  useEffect(() => {
    if (!teamId) return;
    const ddp = getDdpClient();
    const offChange = ddp.onCollectionChange('timers', () => void refetch());
    const unsubscribe = ddp.subscribe('timers.liveForUser', []);
    return () => {
      offChange();
      unsubscribe();
    };
  }, [teamId, refetch]);

  useEffect(() => {
    const onRefetch = () => void refetch();
    const onPlanChanged = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== self) void refetch();
    };
    for (const name of REFETCH_EVENTS) window.addEventListener(name, onRefetch);
    window.addEventListener(PLAN_CHANGED, onPlanChanged);
    return () => {
      for (const name of REFETCH_EVENTS) window.removeEventListener(name, onRefetch);
      window.removeEventListener(PLAN_CHANGED, onPlanChanged);
    };
  }, [refetch, self]);

  /** A plan the server just returned from a change: shown here, re-read elsewhere. */
  const applyChange = useCallback(
    (next: SessionPlan) => {
      readRef.current += 1;
      setPlan(next);
      setError(null);
      setLoading(false);
      window.dispatchEvent(new CustomEvent(PLAN_CHANGED, { detail: self }));
      requestHuddleRefresh();
    },
    [self],
  );

  const setItems = useCallback(
    async (items: PlanItemInput[]) => {
      if (!teamId) return;
      applyChange(await clockApi.setPlan(teamId, items));
    },
    [teamId, applyChange],
  );

  const setChecked = useCallback(
    async (itemId: string, checked: boolean) => {
      if (!teamId) return;
      applyChange(await clockApi.checkPlanItem(teamId, itemId, checked));
    },
    [teamId, applyChange],
  );

  return { teamId, plan, loading, error, refetch, setItems, setChecked };
}
