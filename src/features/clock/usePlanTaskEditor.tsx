/**
 * Today's plan inside a rich editor (M4, #886): the editor kit whose checklist
 * lines carry a ticket's ▶/⏸ and running time, and the timers themselves,
 * drawn into those lines. Used by the editor the plan was written in once
 * clocked in (the Clock page's wrap-up composer), and by the read-only plan
 * where there is no composer.
 *
 * A tick saves at once and is posted to Huddle; each box shows the session
 * plan's state, which touch and go keeps current.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import type { SessionPlanItem } from '../../lib/api';
import type { RunningTicket } from '../../lib/useRunningTicket';
import { TimerControl } from '../../ui/TimerControl';
import { planItemWords } from '../huddle/planItems';
import { clockText } from './clockStrings';
import {
  createPlanTaskKit,
  createPlanTaskRegistry,
  type PlanTaskIdentity,
  type PlanTaskSlot,
} from './planTaskKit';
import { usePlanTicketStart } from './usePlanTicketStart';
import type { SessionPlanState } from './useSessionPlan';

type TicketItem = Extract<SessionPlanItem, { ticketId: string }>;
const isTicket = (item: SessionPlanItem): item is TicketItem => 'ticketId' in item;

/** When a running ticket's time this session counts from: its earlier stints included. */
const countsFrom = (item: TicketItem, runningSince: number) => runningSince - item.seconds * 1000;

/**
 * The plan item a checklist line stands for. A line's words may be as stored
 * (markdown, a picked mention as its link) or as shown (the mention's name).
 */
export function planItemFor(items: readonly SessionPlanItem[], identity: PlanTaskIdentity) {
  return items.find((item) =>
    'ticketId' in identity
      ? isTicket(item) && item.ticketId === identity.ticketId
      : !isTicket(item) &&
        (item.text.trim() === identity.text || planItemWords(item.text).trim() === identity.text),
  );
}

export function usePlanTaskEditor(
  sessionPlan: SessionPlanState,
  runningTicket: RunningTicket | null,
) {
  const { plan, setChecked } = sessionPlan;
  const { togglePlanTicket, isRunning, isBusy, busy, addBackPrompt } = usePlanTicketStart(
    runningTicket,
    sessionPlan,
  );
  const [failure, setFailure] = useState<string | null>(null);

  // One registry and kit for an editor's life: the editor reads its kits once.
  const [registry] = useState(createPlanTaskRegistry);
  const [editorKits] = useState(() => [createPlanTaskKit(registry)]);
  const [slots, setSlots] = useState<PlanTaskSlot[]>([]);
  useEffect(() => {
    const read = () => setSlots(registry.slots());
    read();
    return registry.subscribe(read);
  }, [registry]);

  const items = useMemo(() => plan?.items ?? [], [plan]);
  const checkedOf = (identity: PlanTaskIdentity) => planItemFor(items, identity)?.checked;
  registry.checkedOf = checkedOf;
  registry.onToggle = async (identity, checked) => {
    const item = planItemFor(items, identity);
    if (!item) throw new Error('not in the plan');
    setFailure(null);
    try {
      await setChecked(item.id, checked);
    } catch (err) {
      setFailure(clockText.planCheckFailed);
      throw err;
    }
  };
  useEffect(() => registry.refreshChecks(), [registry, items]);

  const byTicket = useMemo(
    () => new Map(items.filter(isTicket).map((item) => [item.ticketId, item])),
    [items],
  );

  /** Each ticket's timer, in its checklist line in front of the ticket. */
  const timers = (
    <>
      {slots.map((slot) => {
        const item = slot.ticketId ? byTicket.get(slot.ticketId) : undefined;
        if (!item) return null;
        const running = isRunning(item.ticketId);
        return createPortal(
          <TimerControl
            isRunning={running}
            runningSince={running && item.runningSince ? countsFrom(item, item.runningSince) : null}
            isLoading={isBusy(item.ticketId)}
            disabled={busy}
            onClick={() => togglePlanTicket(item.ticketId, item.title)}
            ariaLabel={
              running
                ? clockText.stopPlanTicketLabel(item.title)
                : clockText.startPlanTicketLabel(item.title)
            }
            className="h-7 w-7"
          />,
          slot.element,
          item.id,
        );
      })}
      {addBackPrompt}
    </>
  );

  return { editorKits, timers, failure, checkedOf };
}
