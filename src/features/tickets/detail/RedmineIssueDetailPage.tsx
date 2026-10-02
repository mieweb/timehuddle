/**
 * A Redmine issue, viewed and edited inside TimeHuddle.
 *
 * Laid out like the Huddle ticket page, minus delete (only a Redmine project
 * admin can delete an issue). Its attachments are TimeHuddle's own, the same
 * card as a Huddle ticket's; they are not uploaded to Redmine. Status,
 * priority, assignee and description save straight to Redmine under the user's
 * own key; the status list only offers the transitions Redmine allows them. A
 * save made after someone else changed the issue in Redmine is refused as
 * stale, with a Reload.
 *
 * The header's timer does what a start from the search suggestions does: the
 * issue is pinned into the Tickets table and put on My Board, then timed. It
 * starts through `TicketStartProvider`, so being clocked out opens the same
 * clock-in prompt as everywhere else.
 */
import { faExternalLink, faPen } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  ButtonGroup,
  Card,
  CardContent,
  Select,
  Spinner,
  Text,
  Textarea,
} from '@mieweb/ui';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import {
  ApiError,
  myBoardApi,
  redmineApi,
  timerApi,
  type RedmineFormOptions,
  type RedmineIssueDetail,
  type RedmineIssueEdits,
  type RedmineJournal,
  type RedmineTimeEntry,
  type TicketSession,
} from '../../../lib/api';
import { useRefresh } from '../../../lib/RefreshContext';
import { useBackgroundRefresh } from '../../../lib/useBackgroundRefresh';
import { useRunningTicket } from '../../../lib/useRunningTicket';
import { AppPage } from '../../../ui/AppPage';
import { MarkdownContent } from '../../../ui/MarkdownContent';
import { useRouter } from '../../../ui/router';
import { TimerToggleButton } from '../../../ui/TimerToggleButton';
import { UserAvatar } from '../../../ui/UserAvatar';
import {
  UNASSIGNED,
  assigneeOptions,
  isStaleError,
  mismatchWarning,
  redmineErrorMessage,
  toId,
  toOptions,
} from '../redmine/redmineForm';
import { invalidateRedmineCache } from '../sources';
import { useTicketStart } from '../../timers/TicketStartProvider';
import { timerLabel } from '../../timers/ticketTimerStrings';

import { fromJournals, fromRedmineTimeEntries, fromSessions, mergeByTime } from './activityEntries';
import { BackToTicketsButton } from './BackToTicketsButton';
import { TicketActivityCard } from './TicketActivityCard';
import { TicketAttachmentsCard } from './TicketAttachmentsCard';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

interface LoadedIssue {
  baseUrl: string | null;
  me: number | null;
  pinned: boolean;
  removed: boolean;
  issue: RedmineIssueDetail;
  journals: RedmineJournal[];
  timeEntries: RedmineTimeEntry[] | null;
}

type ActivityFilter = 'mine' | 'all';

/** A read-only sidebar row: label over value. */
function SidebarField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="redmine-issue-sidebar-field">
      <Text size="xs" className="font-semibold text-neutral-700 dark:text-neutral-300">
        {label}
      </Text>
      <div className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">{children}</div>
    </div>
  );
}

export interface RedmineIssueDetailPageProps {
  issueId: number;
}

export const RedmineIssueDetailPage: React.FC<RedmineIssueDetailPageProps> = ({ issueId }) => {
  const { navigate } = useRouter();
  const runningTicket = useRunningTicket(true);
  const { start: startTimer, stop: stopTimer, busyKey } = useTicketStart();

  const [loaded, setLoaded] = useState<LoadedIssue | null>(null);
  const [options, setOptions] = useState<RedmineFormOptions | null>(null);
  const [sessions, setSessions] = useState<TicketSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ code?: string; message: string } | null>(null);

  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionWarning, setActionWarning] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState('');

  const [onBoard, setOnBoard] = useState(false);

  /**
   * Load everything. `quiet` refreshes in place: no page spinner, and a failure
   * keeps what is on screen rather than replacing the page with an error.
   * Resolves whether it worked, for the background refresh's backoff.
   */
  const load = useCallback(
    async (quiet = false): Promise<boolean> => {
      if (!quiet) {
        setLoading(true);
        setLoadError(null);
      }
      try {
        const [result, mySessions, boardEntries] = await Promise.all([
          redmineApi.issues.get(issueId),
          timerApi.getTicketSessions(String(issueId), 'redmine').catch(() => []),
          myBoardApi.list().catch(() => []),
        ]);
        const formOptions = result.issue.project
          ? await redmineApi.projects.formOptions(result.issue.project.id).catch(() => null)
          : null;
        setLoaded(result);
        setSessions(mySessions);
        setOnBoard(
          boardEntries.some((e) => e.sourceId === 'redmine' && e.ticketId === String(issueId)),
        );
        setOptions(formOptions);
        setStale(false);
        return true;
      } catch (err) {
        if (!quiet) {
          setLoadError({
            code: err instanceof ApiError ? err.code : undefined,
            message: redmineErrorMessage(err),
          });
        }
        return false;
      } finally {
        setLoading(false);
      }
    },
    [issueId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useRefresh(
    useCallback(async () => {
      await load(true);
    }, [load]),
  );

  const issue = loaded?.issue ?? null;

  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');
  const activityEntries = useMemo(() => {
    const me = loaded?.me ?? null;
    const all = mergeByTime(
      fromJournals(loaded?.journals ?? [], me),
      fromRedmineTimeEntries(loaded?.timeEntries ?? [], me),
      fromSessions(sessions, 'You'),
    );
    return activityFilter === 'mine' ? all.filter((entry) => entry.mine) : all;
  }, [loaded?.journals, loaded?.timeEntries, loaded?.me, sessions, activityFilter]);

  /**
   * Save one change to Redmine. Only the edited field is sent, and the save is
   * refused as stale if the issue changed in Redmine since this page loaded.
   */
  const save = useCallback(
    async (edits: RedmineIssueEdits) => {
      if (!issue?.updatedAt) return false;
      setSaving(true);
      setActionError(null);
      setActionWarning(null);
      try {
        const result = await redmineApi.issues.update(issue.id, issue.updatedAt, edits);
        setActionWarning(mismatchWarning(result.mismatches));
        // The tickets table caches Redmine rows; drop them so it shows this change.
        invalidateRedmineCache();
        // Refresh in place: new updatedAt, fresh transitions, and the new journal.
        await load(true);
        return true;
      } catch (err) {
        setStale(isStaleError(err));
        setActionError(redmineErrorMessage(err));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [issue, load],
  );

  const ticketKey = `redmine:${issueId}`;
  const isTiming = runningTicket?.key === ticketKey;

  // Redmine can't tell us when the issue changes (no webhooks), so the page asks
  // again: on returning to the tab, and every few minutes while you're active
  // on it. Never while an edit is open or a save is stale: a refresh would move
  // `updatedAt` under the edit and defeat the stale-save check.
  const refreshPaused = editingDesc || saving || stale;
  const refreshPausedRef = React.useRef(refreshPaused);
  refreshPausedRef.current = refreshPaused;
  useBackgroundRefresh(
    useCallback(() => load(true), [load]),
    { paused: refreshPaused },
  );

  // Any timer start or stop (here, or one that waited for a clock-in) fires
  // tickets:refetch: reload in place for the new session and board state, and
  // any time logged since. Mid-edit, only the timer state is refreshed.
  useEffect(() => {
    const refreshTimerState = () => {
      if (!refreshPausedRef.current) {
        void load(true);
        return;
      }
      void timerApi
        .getTicketSessions(String(issueId), 'redmine')
        .then(setSessions)
        .catch(() => {});
      void myBoardApi
        .list()
        .then((entries) =>
          setOnBoard(
            entries.some((e) => e.sourceId === 'redmine' && e.ticketId === String(issueId)),
          ),
        )
        .catch(() => {});
    };
    window.addEventListener('tickets:refetch', refreshTimerState);
    return () => window.removeEventListener('tickets:refetch', refreshTimerState);
  }, [issueId, load]);

  /** Stop this issue's timer, or start one: pinned into the table and on My Board. */
  const toggleTimer = () => {
    const label = timerLabel('redmine', String(issueId));
    if (isTiming && runningTicket) {
      void stopTimer({ sessionId: runningTicket.sessionId, ticketKey, label });
      return;
    }
    // Pinned, or assigned to me and not removed, means the table already has it:
    // nothing to pin. Anything else is pinned, which is harmless when it is in
    // the table anyway (assigned to one of my groups): at the pin cap the server
    // accepts an issue assigned to me through a group, as the table does.
    const inTable =
      !!loaded?.pinned ||
      (!loaded?.removed && loaded?.me != null && issue?.assignedTo?.id === loaded.me);
    void startTimer({
      kind: 'ticket',
      ticket: { sourceId: 'redmine', id: String(issueId) },
      label,
      inTable,
      onBoard,
    });
  };

  const saveDescription = async () => {
    if (await save({ description: descDraft })) setEditingDesc(false);
  };

  // ── Render ──

  const backButton = <BackToTicketsButton />;

  if (loading) {
    return (
      <AppPage>
        <div className="redmine-issue-loading flex items-center justify-center py-24">
          <Spinner size="lg" label="Loading the issue from Redmine" />
        </div>
      </AppPage>
    );
  }

  if (loadError || !loaded || !issue) {
    const notConnected = loadError?.code === 'not-connected';
    return (
      <AppPage>
        {backButton}
        <div className="redmine-issue-error flex flex-col items-center gap-4 py-24 text-center">
          <Text>
            {notConnected
              ? 'Connect your Redmine account in Settings to view Redmine issues here.'
              : (loadError?.message ?? 'Issue not found.')}
          </Text>
          {notConnected ? (
            <Button variant="primary" onClick={() => navigate('/app/settings')}>
              Go to Settings
            </Button>
          ) : (
            <Button variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          )}
        </div>
      </AppPage>
    );
  }

  const redmineUrl = loaded.baseUrl ? `${loaded.baseUrl}/issues/${issue.id}` : null;
  const statusOptions = issue.allowedStatuses.map((status) => ({
    value: String(status.id),
    label: status.isClosed ? `${status.name} (closes the issue)` : status.name,
  }));

  return (
    <AppPage>
      {backButton}

      <div className="redmine-issue-title-section mb-6">
        <div className="redmine-issue-title-row flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
            {issue.subject}
          </h1>
          <TimerToggleButton
            isRunning={isTiming}
            isLoading={busyKey === ticketKey}
            onClick={toggleTimer}
            label={isTiming ? 'Stop timer' : 'Start timer'}
            ariaLabel={
              isTiming ? `Stop the timer on #${issue.id}` : `Start a timer on #${issue.id}`
            }
            className="redmine-issue-timer shrink-0"
          />
        </div>
        <div className="redmine-issue-title-meta mt-1.5 flex flex-wrap items-center gap-2">
          <Text size="sm" variant="muted" className="font-mono">
            #{issue.id}
          </Text>
          <Badge variant="outline">Redmine</Badge>
          {issue.status && (
            <Badge variant={issue.status.isClosed ? 'secondary' : 'success'}>
              {issue.status.name}
            </Badge>
          )}
          {issue.priority && <Badge variant="outline">{issue.priority.name}</Badge>}
          <span className="text-xs text-neutral-400">
            Opened {formatDate(issue.createdAt)}
            {issue.author ? ` by ${issue.author.name}` : ''}
          </span>
          {redmineUrl && (
            <a
              href={redmineUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="redmine-issue-external inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:underline dark:text-primary-400"
            >
              <FontAwesomeIcon icon={faExternalLink} className="h-3 w-3" />
              Open in Redmine
            </a>
          )}
        </div>
      </div>

      {/* Save feedback */}
      <div className="redmine-issue-messages mb-3 space-y-2" aria-live="polite">
        {actionError && (
          <Alert variant={stale ? 'warning' : 'danger'} role="alert">
            <AlertDescription>
              {actionError}
              {stale && (
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-3"
                  onClick={() => {
                    setActionError(null);
                    void load(true);
                  }}
                >
                  Reload
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}
        {actionWarning && (
          <Alert variant="warning" role="status">
            <AlertDescription>{actionWarning}</AlertDescription>
          </Alert>
        )}
      </div>

      {/* Main layout: body + sidebar, like the Huddle ticket page */}
      <div className="redmine-issue-layout flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="redmine-issue-body min-w-0 flex-1 space-y-3">
          <Card>
            <CardContent className="redmine-issue-description">
              <div className="mb-2 flex items-center justify-between">
                <Text size="sm" className="font-semibold text-neutral-700 dark:text-neutral-300">
                  Description
                </Text>
                {!editingDesc && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Edit description"
                    disabled={stale}
                    onClick={() => {
                      setDescDraft(issue.description);
                      setEditingDesc(true);
                    }}
                  >
                    <FontAwesomeIcon icon={faPen} className="h-3 w-3" />
                  </Button>
                )}
              </div>
              {editingDesc ? (
                <div className="redmine-issue-description-edit space-y-2">
                  <Textarea
                    aria-label="Issue description"
                    rows={8}
                    value={descDraft}
                    onChange={(e) => setDescDraft(e.target.value)}
                    helperText="Uses Redmine's formatting. Saved to Redmine as written."
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => void saveDescription()} disabled={saving}>
                      {saving ? 'Saving…' : 'Save'}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setEditingDesc(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : issue.description ? (
                <MarkdownContent content={issue.description} />
              ) : (
                <Text size="sm" className="italic text-neutral-400">
                  No description provided.
                </Text>
              )}
            </CardContent>
          </Card>

          <TicketAttachmentsCard kind="redmine" ticketId={String(issue.id)} />

          {/* Activity: Redmine's history and logged time, plus your own timer sessions */}
          <TicketActivityCard
            entries={activityEntries}
            note={
              loaded.timeEntries === null
                ? "Redmine's history for this issue and the time you logged on it in TimeHuddle. Time logged in Redmine couldn't be loaded."
                : "Redmine's history and the latest time logged on this issue, plus the time you logged on it in TimeHuddle."
            }
            emptyText={activityFilter === 'mine' ? 'No activity of yours yet.' : 'No activity yet.'}
            headerAction={
              <ButtonGroup className="redmine-activity-filter" aria-label="Show activity">
                {(
                  [
                    ['mine', 'My activity'],
                    ['all', 'All'],
                  ] as const
                ).map(([value, label]) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={activityFilter === value ? 'secondary' : 'ghost'}
                    aria-pressed={activityFilter === value}
                    onClick={() => setActivityFilter(value)}
                  >
                    {label}
                  </Button>
                ))}
              </ButtonGroup>
            }
          />
        </div>

        <aside
          className="redmine-issue-sidebar w-full space-y-3 lg:w-72 lg:shrink-0"
          aria-label="Issue details sidebar"
        >
          <Card>
            <CardContent className="redmine-issue-sidebar-fields space-y-4">
              <Select
                label="Status"
                options={statusOptions}
                value={issue.status ? String(issue.status.id) : ''}
                disabled={saving || stale}
                onValueChange={(value) => {
                  const statusId = toId(value);
                  if (statusId && statusId !== issue.status?.id) void save({ statusId });
                }}
                helperText="Only the changes your Redmine role allows are listed."
              />
              <Select
                label="Priority"
                options={toOptions(options?.priorities ?? [], issue.priority)}
                value={issue.priority ? String(issue.priority.id) : ''}
                disabled={saving || stale || !options}
                onValueChange={(value) => {
                  const priorityId = toId(value);
                  if (priorityId && priorityId !== issue.priority?.id) void save({ priorityId });
                }}
              />
              <Select
                label="Assignee"
                searchable
                options={assigneeOptions(
                  options?.assignees ?? [],
                  options?.me ?? null,
                  issue.assignedTo,
                )}
                value={issue.assignedTo ? String(issue.assignedTo.id) : UNASSIGNED}
                disabled={saving || stale || !options}
                onValueChange={(value) => {
                  const assigneeId = toId(value);
                  if (assigneeId !== (issue.assignedTo?.id ?? null)) void save({ assigneeId });
                }}
              />

              <SidebarField label="Project">{issue.project?.name ?? '—'}</SidebarField>
              <SidebarField label="Tracker">{issue.tracker?.name ?? '—'}</SidebarField>
              <SidebarField label="Author">
                {issue.author ? (
                  <span className="flex items-center gap-2">
                    <UserAvatar size="xs" name={issue.author.name} />
                    {issue.author.name}
                  </span>
                ) : (
                  '—'
                )}
              </SidebarField>
              <SidebarField label="Dates">
                <div>Created: {formatDate(issue.createdAt)}</div>
                <div>Updated: {formatDate(issue.updatedAt)}</div>
              </SidebarField>
            </CardContent>
          </Card>

          {/* Deleting is a Redmine admin action, so it is explained, not offered. */}
          <Alert variant="info" className="redmine-issue-no-delete">
            <AlertDescription>
              Issues can't be deleted from TimeHuddle. Contact an admin of the Redmine project to
              delete this issue.
            </AlertDescription>
          </Alert>
        </aside>
      </div>
    </AppPage>
  );
};
