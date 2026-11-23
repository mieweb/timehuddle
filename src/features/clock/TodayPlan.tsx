/**
 * TodayPlan — today's plan on the Clock page while clocked in (M4, #886).
 *
 * The plan's live state: each item, whether it's checked off ("x of y done"),
 * the ticket running now and each ticket's time this session. It reads the
 * session's plan (useSessionPlan), not the Huddle post: the post is what the
 * team read that morning and stays as posted. Checking an item by hand, or
 * adding one in the editor, posts a new update to Huddle instead.
 *
 * Its ticket buttons start that ticket's timer; touch and go then checks off
 * the ticket switched from. The plan is edited with the same editor as the
 * clock-in plan, as text: removing an item is deleting its line.
 */
import {
  ActionPlan,
  Button,
  ButtonGroup,
  Spinner,
  Text,
  type ActionPlanStep,
  type ReferenceTrigger,
} from '@mieweb/ui';
import type { RichEditorHandle } from '@mieweb/ui/kerebron';
import React, {
  Suspense,
  lazy,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import type { SessionPlanItem } from '../../lib/api';
import { formatDuration } from '../../lib/timeUtils';
import type { RunningTicket } from '../../lib/useRunningTicket';
import { useRouter } from '../../ui/router';
import { TimerControl } from '../../ui/TimerControl';
import {
  planChecklist,
  planItemWords,
  planMarkdown,
  ticketPath,
  type PlanItemText,
} from '../huddle/planItems';
import { clockText } from './clockStrings';
import { usePlanTicketStart } from './usePlanTicketStart';
import type { SessionPlanState } from './useSessionPlan';

const MarkdownEditor = lazy(() =>
  import('../huddle/MarkdownEditor').then((m) => ({ default: m.MarkdownEditor })),
);

type TicketItem = Extract<SessionPlanItem, { ticketId: string }>;
const isTicket = (item: SessionPlanItem): item is TicketItem => 'ticketId' in item;

/** When a running ticket's time this session counts from: its earlier stints included. */
const countsFrom = (item: TicketItem, runningSince: number) => runningSince - item.seconds * 1000;

/** The step rows ActionPlan rendered, in order, for each ticket's timer to go in front of. */
function useStepRows(plan: React.RefObject<HTMLElement | null>) {
  const [rows, setRows] = useState<HTMLElement[]>([]);
  useLayoutEffect(() => {
    const found = [
      ...(plan.current?.querySelectorAll<HTMLElement>('[data-slot="action-plan-step"]') ?? []),
    ];
    setRows((prev) =>
      prev.length === found.length && prev.every((row, i) => row === found[i]) ? prev : found,
    );
  });
  return rows;
}

export interface TodayPlanProps {
  sessionPlan: SessionPlanState;
  /** The session's plan post text, which the plan starts from; null when it has none. */
  postedText: string | null;
  /** `@` teammates and `#` tickets in the editor, as in the clock-in composer. */
  triggers: ReferenceTrigger[];
  /** The ticket whose timer is running, if any. */
  runningTicket: RunningTicket | null;
}

export const TodayPlan: React.FC<TodayPlanProps> = ({
  sessionPlan,
  postedText,
  triggers,
  runningTicket,
}) => {
  const { navigate } = useRouter();
  const { plan, loading, error, refetch, setItems, setChecked } = sessionPlan;
  const { togglePlanTicket, isRunning, isBusy, busy } = usePlanTicketStart(
    runningTicket,
    sessionPlan,
  );
  const planRef = useRef<HTMLElement>(null);
  const stepRows = useStepRows(planRef);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [editor, setEditor] = useState<RichEditorHandle | null>(null);

  // A session that has a plan post but no plan yet (just clocked in, or from
  // before plans were kept) starts from the post's items, once.
  const startedFromRef = useRef<string | null>(null);
  useEffect(() => {
    if (!plan || plan.initialized || postedText === null) return;
    if (startedFromRef.current === plan.clockEventId) return;
    startedFromRef.current = plan.clockEventId;
    setItems(planChecklist(postedText), { initial: true }).catch(() => {
      startedFromRef.current = null;
    });
  }, [plan, postedText, setItems]);

  useEffect(() => {
    editor?.focus();
  }, [editor]);

  const items = useMemo(() => plan?.items ?? [], [plan]);
  const steps = useMemo<ActionPlanStep[]>(
    () =>
      items.map((item) => {
        if (!isTicket(item)) {
          return {
            id: item.id,
            title: planItemWords(item.text),
            status: item.checked ? 'done' : 'todo',
          };
        }
        const running = !!item.runningSince;
        return {
          id: item.id,
          title: item.title,
          status: item.checked ? 'done' : running ? 'in_progress' : 'todo',
          // A running ticket's time is under its timer button; a stopped one's
          // logged time shows here once there's a minute of it.
          note: !running && item.seconds >= 60 ? formatDuration(item.seconds) : undefined,
        };
      }),
    [items],
  );
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const startEditing = () => {
    setDraft(
      planMarkdown(
        items.map<PlanItemText>((item) =>
          isTicket(item)
            ? { ticketId: item.ticketId, title: item.title }
            : { text: item.text, checked: item.checked },
        ),
      ),
    );
    setFailure(null);
    setEditing(true);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setFailure(null);
    try {
      // The editor's own content: `draft` can lag the last keystroke.
      const text = editor ? await editor.getContent().catch(() => draft) : draft;
      await setItems(planChecklist(text));
      setEditing(false);
    } catch {
      setFailure(clockText.planSaveFailed);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <section
        className="today-plan-editor flex shrink-0 flex-col gap-3"
        aria-label={clockText.planEditLabel}
      >
        <Text as="h2" size="lg" weight="semibold">
          {clockText.todaysPlan}
        </Text>
        <Text variant="muted" size="sm">
          {clockText.planEditHint}
        </Text>
        <Suspense fallback={<Spinner size="sm" label={clockText.loadingTodaysPlan} />}>
          <MarkdownEditor
            ref={setEditor}
            value={draft}
            onChange={setDraft}
            onSubmit={() => void save()}
            triggers={triggers}
          />
        </Suspense>
        <div role="alert" className="today-plan-error">
          {failure && (
            <Text variant="destructive" size="sm">
              {failure}
            </Text>
          )}
        </div>
        <ButtonGroup>
          <Button variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
            {clockText.cancel}
          </Button>
          <Button variant="primary" onClick={() => void save()} isLoading={saving}>
            {clockText.savePlan}
          </Button>
        </ButtonGroup>
      </section>
    );
  }

  return (
    <div className="today-plan flex shrink-0 flex-col gap-3">
      <ActionPlan
        ref={planRef}
        items={steps}
        title={clockText.todaysPlan}
        headingLevel="h2"
        loading={loading && !plan}
        error={plan ? null : error}
        onRetry={() => void refetch()}
        arrange="manual"
        onAdd={startEditing}
        onStatusChange={async (id, status) => {
          setFailure(null);
          try {
            await setChecked(id, status === 'done');
          } catch (err) {
            setFailure(clockText.planCheckFailed);
            // The checkbox puts itself back when the change is refused.
            throw err;
          }
        }}
        getHref={(id) => {
          const item = byId.get(id);
          return item && isTicket(item) ? ticketPath(item.ticketId) : '';
        }}
        // A ticket opens in the app; a line of text opens the plan to edit it.
        onOpen={(id) => {
          const item = byId.get(id);
          if (item && isTicket(item)) navigate(ticketPath(item.ticketId));
          else startEditing();
        }}
        labels={{
          title: clockText.todaysPlan,
          progress: clockText.planProgress,
          inProgress: clockText.planWorking,
          todo: clockText.planTodo,
          done: clockText.planDone,
          overdue: clockText.planOverdue,
          addStep: clockText.editPlan,
          loading: clockText.loadingTodaysPlan,
          empty: clockText.noPlanItems,
          error: clockText.planLoadFailed,
          retry: clockText.retry,
        }}
      />
      <div role="alert" className="today-plan-error">
        {failure && (
          <Text variant="destructive" size="sm">
            {failure}
          </Text>
        )}
      </div>
      {/* Each ticket's timer, in front of it in its row (ActionPlan has no
          slot there): the plan is the launching point for the day. */}
      {steps.map((step, i) => {
        const item = byId.get(step.id);
        const row = stepRows[i];
        if (!item || !isTicket(item) || !row) return null;
        const running = isRunning(item.ticketId);
        return createPortal(
          <span className="today-plan-timer order-first -my-1">
            <TimerControl
              isRunning={running}
              runningSince={
                running && item.runningSince ? countsFrom(item, item.runningSince) : null
              }
              isLoading={isBusy(item.ticketId)}
              disabled={busy}
              onClick={() => togglePlanTicket(item.ticketId, item.title)}
              ariaLabel={
                running
                  ? clockText.stopPlanTicketLabel(item.title)
                  : clockText.startPlanTicketLabel(item.title)
              }
              className="h-8 w-8"
            />
          </span>,
          row,
          step.id,
        );
      })}
    </div>
  );
};
