/**
 * TodayPlan — today's plan on the Clock page while clocked in (M4, #886).
 *
 * The plan stays in the same rich editor it was written in, read-only: every
 * item is a checklist line, and a ticket's line has its ▶/⏸ in front of it
 * with the running time under the button. There's no editing by hand once
 * clocked in — a tick saves at once and is posted to Huddle, and the only
 * other change mid-session is a pinned ticket joining the plan (M2).
 *
 * It shows the session's plan (useSessionPlan), not the Huddle post: the post
 * is what the team read that morning and stays as posted. Starting a ticket
 * goes through useTicketStart; touch and go then checks off the one before.
 */
import { Spinner, Text, type ReferenceTrigger } from '@mieweb/ui';
import type { ModifyMenu } from '@mieweb/ui/kerebron';
import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import type { SessionPlanItem } from '../../lib/api';
import type { RunningTicket } from '../../lib/useRunningTicket';
import { TimerControl } from '../../ui/TimerControl';
import { planMarkdown } from '../huddle/planItems';
import { clockText } from './clockStrings';
import {
  createPlanTaskKit,
  createPlanTaskRegistry,
  type PlanTaskIdentity,
  type PlanTaskSlot,
} from './planTaskKit';
import { usePlanTicketStart } from './usePlanTicketStart';
import type { SessionPlanState } from './useSessionPlan';

const MarkdownEditor = lazy(() =>
  import('../huddle/MarkdownEditor').then((m) => ({ default: m.MarkdownEditor })),
);

type TicketItem = Extract<SessionPlanItem, { ticketId: string }>;
const isTicket = (item: SessionPlanItem): item is TicketItem => 'ticketId' in item;

/** When a running ticket's time this session counts from: its earlier stints included. */
const countsFrom = (item: TicketItem, runningSince: number) => runningSince - item.seconds * 1000;

/** Read-only: no formatting toolbar. */
const NO_TOOLBAR: ModifyMenu = () => [];

const noop = () => {};

/** The plan item a checklist line stands for. */
function itemFor(items: readonly SessionPlanItem[], identity: PlanTaskIdentity) {
  return items.find((item) =>
    'ticketId' in identity
      ? isTicket(item) && item.ticketId === identity.ticketId
      : !isTicket(item) && item.text.trim() === identity.text,
  );
}

export interface TodayPlanProps {
  sessionPlan: SessionPlanState;
  /** `#` tickets drawn as chips, as in the clock-in composer. */
  triggers: ReferenceTrigger[];
  /** The ticket whose timer is running, if any. */
  runningTicket: RunningTicket | null;
}

export const TodayPlan: React.FC<TodayPlanProps> = ({ sessionPlan, triggers, runningTicket }) => {
  const { plan, loading, error, setChecked } = sessionPlan;
  const { togglePlanTicket, isRunning, isBusy, busy } = usePlanTicketStart(
    runningTicket,
    sessionPlan,
  );
  const [failure, setFailure] = useState<string | null>(null);

  // One registry and kit for the editor's life: the editor reads its kits once.
  const [registry] = useState(createPlanTaskRegistry);
  const [editorKits] = useState(() => [createPlanTaskKit(registry)]);
  const [slots, setSlots] = useState<PlanTaskSlot[]>([]);
  useEffect(() => {
    const read = () => setSlots(registry.slots());
    read();
    return registry.subscribe(read);
  }, [registry]);

  const items = useMemo(() => plan?.items ?? [], [plan]);
  // A tick saves at once; the plan the server keeps comes back as the editor's value.
  registry.onToggle = async (identity, checked) => {
    const item = itemFor(items, identity);
    if (!item) throw new Error('not in the plan');
    setFailure(null);
    try {
      await setChecked(item.id, checked);
    } catch (err) {
      setFailure(clockText.planCheckFailed);
      throw err;
    }
  };

  registry.checkedOf = (identity) => itemFor(items, identity)?.checked;
  useEffect(() => registry.refreshChecks(), [registry, items]);

  const text = useMemo(
    () =>
      planMarkdown(
        items.map((item) =>
          isTicket(item)
            ? { ticketId: item.ticketId, title: item.title, checked: item.checked }
            : { text: item.text, checked: item.checked },
        ),
      ),
    [items],
  );
  const byTicket = useMemo(
    () => new Map(items.filter(isTicket).map((item) => [item.ticketId, item])),
    [items],
  );
  const done = items.filter((item) => item.checked).length;

  if (!plan) {
    if (loading) return <Spinner size="sm" label={clockText.loadingTodaysPlan} />;
    if (error) {
      return (
        <Text variant="destructive" size="sm" role="alert">
          {clockText.planLoadFailed}
        </Text>
      );
    }
    return null;
  }
  // No plan this session (none posted): nothing to show until one is pinned (M2).
  if (items.length === 0) return null;

  return (
    <section className="today-plan flex shrink-0 flex-col gap-2" aria-label={clockText.todaysPlan}>
      <div className="today-plan-heading flex items-baseline justify-between gap-2">
        <Text as="h2" size="lg" weight="semibold">
          {clockText.todaysPlan}
        </Text>
        <Text variant="muted" size="sm">
          {clockText.planProgress(done, items.length)}
        </Text>
      </div>
      <Suspense fallback={<Spinner size="sm" label={clockText.loadingTodaysPlan} />}>
        <MarkdownEditor
          className="today-plan-editor"
          value={text}
          onChange={noop}
          triggers={triggers}
          readOnly
          editorKits={editorKits}
          modifyMenu={NO_TOOLBAR}
        />
      </Suspense>
      <div role="alert" className="today-plan-error">
        {failure && (
          <Text variant="destructive" size="sm">
            {failure}
          </Text>
        )}
      </div>
      {/* Each ticket's timer, in its checklist line in front of the ticket. */}
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
    </section>
  );
};
