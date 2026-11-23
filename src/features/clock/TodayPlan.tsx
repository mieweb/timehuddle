/**
 * TodayPlan — today's plan on the Clock page while clocked in (M4, #886), for
 * a session with no composer to show it in: on a team that requires a plan,
 * the wrap-up composer is the plan's editor and shows it itself
 * (usePlanTaskEditor). Here it's the same editor, read-only: every item a
 * checklist line, a ticket's with its ▶/⏸ in front and the running time under
 * the button. A tick saves at once and is posted to Huddle.
 */
import { Spinner, Text, type ReferenceTrigger } from '@mieweb/ui';
import type { ModifyMenu } from '@mieweb/ui/kerebron';
import React, { Suspense, lazy, useMemo } from 'react';

import type { RunningTicket } from '../../lib/useRunningTicket';
import { planMarkdown } from '../huddle/planItems';
import { clockText } from './clockStrings';
import { usePlanTaskEditor } from './usePlanTaskEditor';
import type { SessionPlanState } from './useSessionPlan';

const MarkdownEditor = lazy(() =>
  import('../huddle/MarkdownEditor').then((m) => ({ default: m.MarkdownEditor })),
);

/** Read-only: no formatting toolbar. */
const NO_TOOLBAR: ModifyMenu = () => [];

const noop = () => {};

export interface TodayPlanProps {
  sessionPlan: SessionPlanState;
  /** `#` tickets drawn as chips, as in the clock-in composer. */
  triggers: ReferenceTrigger[];
  /** The ticket whose timer is running, if any. */
  runningTicket: RunningTicket | null;
}

export const TodayPlan: React.FC<TodayPlanProps> = ({ sessionPlan, triggers, runningTicket }) => {
  const { plan, loading, error } = sessionPlan;
  const { editorKits, timers, failure } = usePlanTaskEditor(sessionPlan, runningTicket);

  const items = useMemo(() => plan?.items ?? [], [plan]);
  const text = useMemo(
    () =>
      planMarkdown(
        items.map((item) =>
          'ticketId' in item
            ? { ticketId: item.ticketId, title: item.title, checked: item.checked }
            : { text: item.text, checked: item.checked },
        ),
      ),
    [items],
  );
  const done = items.filter((item) => item.checked).length;

  if (!plan) {
    if (loading) return <Spinner size="sm" label={clockText.loadingTodaysPlan} />;
    if (error) {
      return (
        <Text variant="destructive" size="sm" role="alert">
          {clockText.planLoadFailedWith(error.message)}
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
      {timers}
    </section>
  );
};
