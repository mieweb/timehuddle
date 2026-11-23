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
import { faPlay } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
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
import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';

import type { SessionPlanItem } from '../../lib/api';
import { formatDuration, formatTimer } from '../../lib/timeUtils';
import { useRouter } from '../../ui/router';
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

/** A ticket's whole time this session, its running stint up to `now` included. */
export function planTicketSeconds(item: TicketItem, now: number): number {
  const running = item.runningSince ? Math.floor((now - item.runningSince) / 1000) : 0;
  return item.seconds + Math.max(0, running);
}

/** How a ticket's button names it: the ID it leads with (`TH-12`). */
const ticketRef = (title: string) => title.split(': ')[0];

export interface TodayPlanProps {
  sessionPlan: SessionPlanState;
  /** The session's plan post text, which the plan starts from; null when it has none. */
  postedText: string | null;
  /** `@` teammates and `#` tickets in the editor, as in the clock-in composer. */
  triggers: ReferenceTrigger[];
  /** Ticks every second, for the running ticket's time. */
  now: number;
}

export const TodayPlan: React.FC<TodayPlanProps> = ({ sessionPlan, postedText, triggers, now }) => {
  const { navigate } = useRouter();
  const { plan, loading, error, refetch, setItems, setChecked } = sessionPlan;
  const { startPlanTicket, isStarting, busy } = usePlanTicketStart();
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
        const seconds = planTicketSeconds(item, now);
        return {
          id: item.id,
          title: item.title,
          status: item.checked ? 'done' : running ? 'in_progress' : 'todo',
          // Under a minute reads as "0m": say nothing until there's time to show.
          note:
            running || seconds >= 60
              ? clockText.planItemTime(
                  running ? formatTimer(seconds) : formatDuration(seconds),
                  running,
                )
              : undefined,
        };
      }),
    [items, now],
  );
  const tickets = items.filter(isTicket);
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
      {/* The plan is the launching point: each ticket not running starts here. */}
      {tickets.some((item) => !item.runningSince) && (
        <div className="today-plan-start flex flex-wrap items-center gap-2">
          <Text variant="muted" size="sm">
            {clockText.workOn}
          </Text>
          <ButtonGroup>
            {tickets
              .filter((item) => !item.runningSince)
              .map((item) => (
                <Button
                  key={item.id}
                  variant="outline"
                  size="sm"
                  leftIcon={<FontAwesomeIcon icon={faPlay} aria-hidden />}
                  isLoading={isStarting(item.ticketId)}
                  disabled={busy}
                  aria-label={clockText.startPlanTicketLabel(item.title)}
                  onClick={() => void startPlanTicket(item.ticketId, item.title)}
                >
                  {ticketRef(item.title)}
                </Button>
              ))}
          </ButtonGroup>
        </div>
      )}
    </div>
  );
};
