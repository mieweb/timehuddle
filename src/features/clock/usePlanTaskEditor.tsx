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
import { TimePill } from '../../ui/TimePill';
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
type TextItem = Exclude<SessionPlanItem, TicketItem>;

/** When a running ticket's time this session counts from: its earlier stints included. */
const countsFrom = (item: TicketItem, runningSince: number) => runningSince - item.seconds * 1000;

/**
 * A line's words for matching, whether as stored (markdown, a picked mention
 * as its link) or as shown (its chip): links read as their label, and
 * markdown's emphasis, code and escape characters, and a mention's `@`, don't count.
 */
const looseWords = (text: string) =>
  planItemWords(text)
    .replace(/[*_~`\\@]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** The plan items a checklist line stands for: its tickets the plan holds, or its line of text. */
export function planItemsFor(
  items: readonly SessionPlanItem[],
  identity: PlanTaskIdentity,
): SessionPlanItem[] {
  if ('ticketIds' in identity) {
    return identity.ticketIds.flatMap(
      (ticketId) => items.find((item) => isTicket(item) && item.ticketId === ticketId) ?? [],
    );
  }
  const texts = items.filter((item): item is TextItem => !isTicket(item));
  const shown = identity.text.replace(/\s+/g, ' ').trim();
  const exact = texts.find(
    (item) => item.text.trim() === shown || planItemWords(item.text).trim() === shown,
  );
  if (exact) return [exact];
  // Loosely, only when one line reads that way: two may differ by markup alone.
  const words = looseWords(shown);
  const loose = texts.filter((item) => looseWords(item.text) === words);
  return loose.length === 1 ? loose : [];
}

/** A line is checked when all it stands for is; undefined when the plan holds none of it. */
const checkedOfItems = (found: SessionPlanItem[]) =>
  found.length ? found.every((item) => item.checked) : undefined;

export function usePlanTaskEditor(
  sessionPlan: SessionPlanState,
  runningTicket: RunningTicket | null,
) {
  const { plan, error, setChecked } = sessionPlan;
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
  registry.ready = () => plan !== null;
  registry.checkedOf = (identity) => checkedOfItems(planItemsFor(items, identity));
  registry.onToggle = async (identity, checked) => {
    const changing = planItemsFor(items, identity).filter((item) => item.checked !== checked);
    setFailure(null);
    try {
      for (const item of changing) await setChecked(item.id, checked);
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

  /**
   * Each ticket's ▶/⏸ in front of it, and its time this session in a pill
   * under it, always: ticking while it runs, frozen while it doesn't.
   */
  const timers = (
    <>
      {slots.map((slot) => {
        const lineItems = slot.ticketIds.flatMap((ticketId) => byTicket.get(ticketId) ?? []);
        if (!lineItems.length) return null;
        const since = (item: TicketItem) =>
          isRunning(item.ticketId) && item.runningSince
            ? countsFrom(item, item.runningSince)
            : null;
        return [
          createPortal(
            <span className="plan-task-pills inline-flex flex-wrap gap-1">
              {lineItems.map((item) => {
                const runningSince = since(item);
                return (
                  <TimePill
                    key={item.id}
                    runningSince={runningSince}
                    seconds={item.seconds}
                    label={
                      runningSince !== null
                        ? clockText.planTicketTimeRunning(item.title)
                        : clockText.planTicketTimePaused(item.title)
                    }
                  />
                );
              })}
            </span>,
            slot.timeElement,
            `${lineItems[0].id}-time`,
          ),
          createPortal(
            <span className="plan-task-timers inline-flex gap-1">
              {lineItems.map((item) => {
                const running = isRunning(item.ticketId);
                return (
                  <TimerControl
                    key={item.id}
                    isRunning={running}
                    isLoading={isBusy(item.ticketId)}
                    disabled={busy}
                    onClick={() => togglePlanTicket(item.ticketId, item.title)}
                    ariaLabel={
                      running
                        ? clockText.stopPlanTicketLabel(item.title)
                        : clockText.startPlanTicketLabel(item.title)
                    }
                    className="h-7 w-7"
                  />
                );
              })}
            </span>,
            slot.element,
            lineItems[0].id,
          ),
        ];
      })}
      {addBackPrompt}
    </>
  );

  /** A plan line's check, as `withChecks` asks for it when the text is saved. */
  const checkedOf = (identity: { ticketId: string } | { text: string }) =>
    checkedOfItems(
      planItemsFor(items, 'ticketId' in identity ? { ticketIds: [identity.ticketId] } : identity),
    );

  // A plan that can't be read says why: its boxes don't act until it is.
  const shownFailure =
    failure ?? (!plan && error ? clockText.planLoadFailedWith(error.message) : null);

  return { editorKits, timers, failure: shownFailure, checkedOf };
}
