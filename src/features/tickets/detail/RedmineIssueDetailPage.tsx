/**
 * A Redmine issue, viewed and edited inside TimeHuddle (M6).
 *
 * Laid out like the Huddle ticket page, minus what doesn't apply to Redmine:
 * no attachments, and no delete (only a Redmine project admin can delete an
 * issue). Status, priority, assignee and description save straight to Redmine
 * under the user's own key; the status list only offers the transitions
 * Redmine allows them. A save made after someone else changed the issue in
 * Redmine is refused as stale, with a Reload.
 */
import { faArrowLeft, faExternalLink, faPen } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
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
  redmineApi,
  timerApi,
  type RedmineFormOptions,
  type RedmineIssueDetail,
  type RedmineIssueEdits,
  type RedmineJournal,
  type TicketSession,
} from '../../../lib/api';
import { useRefresh } from '../../../lib/RefreshContext';
import { AppPage } from '../../../ui/AppPage';
import { MarkdownContent } from '../../../ui/MarkdownContent';
import { useRouter } from '../../../ui/router';
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

import { fromJournals, fromSessions, mergeByTime } from './activityEntries';
import { TicketActivityCard } from './TicketActivityCard';

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
  issue: RedmineIssueDetail;
  journals: RedmineJournal[];
}

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

  /** Load everything; `quiet` refreshes in place without the page spinner. */
  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setLoadError(null);
      try {
        const [result, mySessions] = await Promise.all([
          redmineApi.issues.get(issueId),
          timerApi.getTicketSessions(String(issueId), 'redmine').catch(() => []),
        ]);
        const formOptions = result.issue.project
          ? await redmineApi.projects.formOptions(result.issue.project.id).catch(() => null)
          : null;
        setLoaded(result);
        setSessions(mySessions);
        setOptions(formOptions);
        setStale(false);
      } catch (err) {
        setLoadError({
          code: err instanceof ApiError ? err.code : undefined,
          message: redmineErrorMessage(err),
        });
      } finally {
        setLoading(false);
      }
    },
    [issueId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useRefresh(useCallback(() => load(true), [load]));

  const issue = loaded?.issue ?? null;

  const activityEntries = useMemo(
    () => mergeByTime(fromJournals(loaded?.journals ?? []), fromSessions(sessions, 'You')),
    [loaded?.journals, sessions],
  );

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

  const saveDescription = async () => {
    if (await save({ description: descDraft })) setEditingDesc(false);
  };

  // ── Render ──

  const backButton = (
    <div className="redmine-issue-back mb-4">
      <Button
        variant="outline"
        size="sm"
        aria-label="Back to tickets"
        leftIcon={<FontAwesomeIcon icon={faArrowLeft} />}
        onClick={() => navigate('/app/tickets')}
      >
        TICKETS
      </Button>
    </div>
  );

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

      {/* Title section */}
      <div className="redmine-issue-title-section mb-6">
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          {issue.subject}
        </h1>
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
          {/* Description */}
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

          {/* Activity: Redmine's history plus your own timer sessions */}
          <TicketActivityCard
            entries={activityEntries}
            note="Redmine's history for this issue, plus the time you logged on it in TimeHuddle."
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
