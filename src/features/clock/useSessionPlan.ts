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

import { clockApi, type SessionPlan, type SessionPlanItem } from '../../lib/api';
import { getDdpClient } from '../../lib/ddp';
import { requestHuddleRefresh } from '../../lib/huddleRefresh';
import { useTeam } from '../../lib/TeamContext';
import type { PlanItemInput } from '../huddle/planItems';

const PLAN_CHANGED = 'plan:changed';

/** The plan's items as an edit sends them: tickets by id, text with its check. */
export function planInputOf(items: readonly SessionPlanItem[]): PlanItemInput[] {
  return items.map((item) =>
    'ticketId' in item ? { ticketId: item.ticketId } : { text: item.text, checked: item.checked },
  );
}
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
  /** Add these tickets after the plan's items, skipping any it holds. */
  addTickets: (ticketIds: string[]) => Promise<void>;
}

export function useSessionPlan(): SessionPlanState {
  const { activeClockEvent } = useTeam();
  const teamId = activeClockEvent && !activeClockEvent.endTime ? activeClockEvent.teamId : null;
  const eventId = activeClockEvent?.id ?? null;
  const storedRev = activeClockEvent?.planRev ?? null;
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
  }, [refetch, eventId, storedRev]);

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

  /**
   * After a change: re-read rather than show the plan it returned, since of
   * two changes at once the older reply can arrive last. Re-read elsewhere too.
   */
  const afterChange = useCallback(async () => {
    window.dispatchEvent(new CustomEvent(PLAN_CHANGED, { detail: self }));
    requestHuddleRefresh();
    await refetch();
  }, [self, refetch]);

  const setItems = useCallback(
    async (items: PlanItemInput[]) => {
      if (!teamId) return;
      await clockApi.setPlan(teamId, items);
      await afterChange();
    },
    [teamId, afterChange],
  );

  const setChecked = useCallback(
    async (itemId: string, checked: boolean) => {
      if (!teamId) return;
      await clockApi.checkPlanItem(teamId, itemId, checked);
      await afterChange();
    },
    [teamId, afterChange],
  );

  // Read fresh, not from `plan`: a stale copy would drop items added since.
  const addTickets = useCallback(
    async (ticketIds: string[]) => {
      if (!teamId || !ticketIds.length) return;
      const current = await clockApi.getPlan(teamId);
      if (!current) return;
      const held = new Set(
        current.items.flatMap((item) => ('ticketId' in item ? [item.ticketId] : [])),
      );
      const added = [...new Set(ticketIds)].filter((id) => !held.has(id));
      if (!added.length) return;
      await setItems([...planInputOf(current.items), ...added.map((ticketId) => ({ ticketId }))]);
    },
    [teamId, setItems],
  );

  return { teamId, plan, loading, error, refetch, setItems, setChecked, addTickets };
}
