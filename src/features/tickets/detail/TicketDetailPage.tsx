import {
  faCopy,
  faLink,
  faPen,
  faTrash,
  faCheck,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Alert,
  AlertDescription,
  Badge,
  type BadgeProps,
  Button,
  Card,
  CardContent,
  Checkbox,
  Select,
  Spinner,
  Text,
  Textarea,
  Input,
} from '@mieweb/ui';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  activityApi,
  teamApi,
  ticketApi,
  timerApi,
  type ActivityLogItem,
  type TeamMember,
  type Ticket,
  type TicketLinkStatus,
  type TicketSession,
} from '../../../lib/api';
import { classifyLoadError } from '../../../lib/loadError';
import { useBackgroundRefresh } from '../../../lib/useBackgroundRefresh';
import { useSession } from '../../../lib/useSession';
import { useTeam } from '../../../lib/TeamContext';
import { useRefresh } from '../../../lib/RefreshContext';
import { useCopyLink } from '../../../lib/useCopyLink';
import { AppPage } from '../../../ui/AppPage';
import { MarkdownContent } from '../../../ui/MarkdownContent';
import { NoAccessState, type NoAccessKind } from '../../../ui/NoAccessState';
import { useRouter } from '../../../ui/router';
import { UserAvatar } from '../../../ui/UserAvatar';
import { PRIORITY_OPTIONS } from '../huddleTicketOptions';
import { LinkedIssueSection } from '../link/LinkedIssueSection';
import { huddleTicketRef } from '../sources';

import { fromHuddleEvents, fromSessions, mergeByTime } from './activityEntries';
import { BackToTicketsButton } from './BackToTicketsButton';
import { TicketActivityCard } from './TicketActivityCard';
import { TicketAttachmentsCard } from './TicketAttachmentsCard';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'in-progress', label: 'In Progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'closed', label: 'Closed' },
];

/** Badge variants carry the brand palette, so priority maps to a variant
 *  rather than to a hand-picked colour pair per state. */
function priorityVariant(priority: string | null): BadgeProps['variant'] {
  switch (priority) {
    case 'critical':
      return 'danger';
    case 'high':
      return 'warning';
    case 'medium':
      return 'secondary';
    case 'low':
      return 'outline';
    default:
      return 'default';
  }
}

function statusVariant(status: string): BadgeProps['variant'] {
  switch (status) {
    case 'open':
      return 'success';
    case 'in-progress':
      return 'secondary';
    case 'blocked':
      return 'danger';
    case 'reviewed':
      return 'outline';
    default:
      return 'default';
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

interface TicketDetailPageProps {
  ticketId: string;
}

export const TicketDetailPage: React.FC<TicketDetailPageProps> = ({ ticketId }) => {
  const { navigate } = useRouter();
  const copyLink = useCopyLink();
  const { user } = useSession();
  const { teams } = useTeam();

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [activity, setActivity] = useState<ActivityLogItem[]>([]);
  const [sessions, setSessions] = useState<TicketSession[]>([]);
  const [idCopied, setIdCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Set when the ticket can't be shown at all: forbidden vs. doesn't exist.
  const [unavailable, setUnavailable] = useState<NoAccessKind | null>(null);

  // Edit state
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Who is timing this ticket, if it is linked: while anyone is, the server
  // refuses changes to it. The timer may be a teammate's, which nothing pushes
  // to this page, so it is asked again in the background and after a refusal.
  const [lock, setLock] = useState<TicketLinkStatus['lock']>(null);
  const loadLock = useCallback(
    () =>
      ticketApi.linkStatus(ticketId).then(
        (status) => {
          setLock(status.lock);
          return true;
        },
        () => false,
      ),
    [ticketId],
  );
  const linkedIssueId = ticket?.linkedIssue?.id ?? null;
  useEffect(() => {
    void loadLock();
    const onRefetch = () => void loadLock();
    // Fired when the viewer's own timer starts or stops.
    window.addEventListener('tickets:refetch', onRefetch);
    return () => window.removeEventListener('tickets:refetch', onRefetch);
  }, [loadLock, linkedIssueId]);
  useBackgroundRefresh(loadLock);

  /** Show why a change was refused; a lock refusal also refreshes the banner. */
  const showFailure = (err: unknown, fallback: string) => {
    setActionError(err instanceof ApiError && err.message ? err.message : fallback);
    if (err instanceof ApiError && err.code === 'ticket-locked') void loadLock();
  };

  // Load ticket + activity
  useEffect(() => {
    setLoading(true);
    setError(null);
    setUnavailable(null);
    Promise.all([
      ticketApi.getTicket(ticketId),
      activityApi.getTicketActivity(ticketId, 50).catch(() => ({ events: [] })),
      timerApi.getTicketSessions(ticketId, 'huddle').catch(() => []),
    ])
      .then(([t, a, s]) => {
        setTicket(t);
        setActivity(a.events);
        setSessions(s);
        setTitleDraft(t.title);
        setDescDraft(t.description ?? '');
      })
      .catch((err: unknown) => {
        const kind = classifyLoadError(err);
        if (kind === 'error') setError('Could not load this ticket. Check your connection.');
        else setUnavailable(kind);
      })
      .finally(() => setLoading(false));
  }, [ticketId]);

  useRefresh(
    React.useCallback(async () => {
      setLoading(true);
      try {
        const [t, a, s] = await Promise.all([
          ticketApi.getTicket(ticketId),
          activityApi.getTicketActivity(ticketId, 50).catch(() => ({ events: [] })),
          timerApi.getTicketSessions(ticketId, 'huddle').catch(() => []),
        ]);
        setTicket(t);
        setActivity(a.events);
        setSessions(s);
        void loadLock();
      } catch {
        setError('Failed to refresh ticket.');
      } finally {
        setLoading(false);
      }
    }, [ticketId, loadLock]),
  );

  // Load team members once we have the teamId
  useEffect(() => {
    if (!ticket?.teamId) return;
    teamApi
      .getMembers(ticket.teamId)
      .then(setMembers)
      .catch(() => setActionError('Failed to load team members. Assignee cannot be changed.'));
  }, [ticket?.teamId]);

  // Huddle's activity log plus the viewer's own timer sessions, newest first.
  const activityEntries = useMemo(
    () => mergeByTime(fromHuddleEvents(activity), fromSessions(sessions, 'You')),
    [activity, sessions],
  );

  // ── Handlers ──

  const copyTicketId = async () => {
    if (!ticket) return;
    try {
      await navigator.clipboard.writeText(ticket.id);
      setIdCopied(true);
      window.setTimeout(() => setIdCopied(false), 2000);
    } catch {
      setActionError('Could not copy the ticket id.');
    }
  };

  const saveTitle = async () => {
    if (!ticket || !titleDraft.trim() || titleDraft === ticket.title) {
      setEditingTitle(false);
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const updated = await ticketApi.updateTicket(ticket.id, { title: titleDraft.trim() });
      setTicket(updated);
    } catch (err) {
      showFailure(err, 'Failed to save the title.');
    } finally {
      setSaving(false);
      setEditingTitle(false);
    }
  };

  const saveDescription = async () => {
    if (!ticket) return;
    setSaving(true);
    setActionError(null);
    try {
      const updated = await ticketApi.updateTicket(ticket.id, { description: descDraft });
      setTicket(updated);
    } catch (err) {
      showFailure(err, 'Failed to save the description.');
    } finally {
      setSaving(false);
      setEditingDesc(false);
    }
  };

  const handleStatusChange = async (status: string) => {
    if (!ticket) return;
    setActionError(null);
    try {
      const updated = await ticketApi.updateStatusPriority(ticket.id, { status });
      setTicket(updated);
    } catch (err) {
      showFailure(err, 'Failed to update status.');
    }
  };

  const handlePriorityChange = async (priority: string) => {
    if (!ticket) return;
    setActionError(null);
    try {
      const updated = await ticketApi.updateStatusPriority(ticket.id, { priority });
      setTicket(updated);
    } catch (err) {
      showFailure(err, 'Failed to update priority.');
    }
  };

  const handleAssigneesChange = async (assignedToUserIds: string | string[]) => {
    if (!ticket) return;
    setActionError(null);
    try {
      const ids = Array.isArray(assignedToUserIds)
        ? assignedToUserIds
        : assignedToUserIds
          ? [assignedToUserIds]
          : [];
      const updated = await ticketApi.assignTicket(ticket.id, ids);
      setTicket(updated);
    } catch (err) {
      showFailure(err, 'Failed to update assignees. You may not have permission.');
    }
  };

  const handleDelete = async () => {
    if (!ticket || !confirm(`Delete "${ticket.title}"?`)) return;
    setActionError(null);
    try {
      await ticketApi.deleteTicket(ticket.id);
      navigate('/app/tickets');
    } catch (err) {
      showFailure(err, 'Failed to delete the ticket.');
    }
  };

  // ── Render ──

  if (loading) {
    return (
      <AppPage>
        <div className="ticket-detail-loading flex items-center justify-center py-24">
          <Spinner />
        </div>
      </AppPage>
    );
  }

  if (unavailable) {
    return (
      <AppPage>
        <NoAccessState kind={unavailable} resource="ticket" />
      </AppPage>
    );
  }

  if (error || !ticket) {
    return (
      <AppPage>
        <div className="ticket-detail-error flex flex-col items-center gap-4 py-24">
          <Text>{error ?? 'Ticket not found.'}</Text>
          <Button variant="outline" onClick={() => navigate('/app/tickets')}>
            Back to Tickets
          </Button>
        </div>
      </AppPage>
    );
  }

  const assigneeOptions = [
    { value: '', label: 'Unassigned' },
    ...members.map((m) => ({ value: m.id, label: m.name || m.email })),
  ];

  const creatorMember = members.find((m) => m.id === ticket.createdBy);
  const creatorName = creatorMember?.name || creatorMember?.email || ticket.createdBy;

  const canEdit =
    user?.id === ticket.createdBy ||
    members.some((m) => m.id === user?.id && (m as unknown as { role?: string }).role === 'admin');
  const locked = lock !== null;

  return (
    <AppPage>
      <BackToTicketsButton
        actions={
          <Button
            variant="secondary"
            size="sm"
            aria-label="Copy link to this ticket"
            className="rounded-full"
            onClick={() => void copyLink(`/app/tickets/${ticket.id}`)}
            leftIcon={<FontAwesomeIcon icon={faLink} size="sm" />}
          >
            Copy Link
          </Button>
        }
      />

      {/* Full-width title section */}
      <div className="ticket-detail-title-section mb-6">
        {editingTitle ? (
          <div className="ticket-title-edit flex items-start gap-2">
            <Input
              aria-label="Ticket title"
              className="flex-1 text-xl font-semibold"
              value={titleDraft}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitleDraft(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === 'Enter') void saveTitle();
                if (e.key === 'Escape') setEditingTitle(false);
              }}
              autoFocus
            />
            <Button size="sm" aria-label="Save title" onClick={saveTitle} disabled={saving}>
              <FontAwesomeIcon icon={faCheck} />
            </Button>
            <Button
              size="sm"
              variant="outline"
              aria-label="Cancel title edit"
              onClick={() => {
                setEditingTitle(false);
                setTitleDraft(ticket.title);
              }}
            >
              <FontAwesomeIcon icon={faXmark} />
            </Button>
          </div>
        ) : (
          <div className="ticket-title-display flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
              {ticket.title}
            </h1>
            {canEdit && !locked && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Edit title"
                onClick={() => setEditingTitle(true)}
              >
                <FontAwesomeIcon icon={faPen} className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        )}

        {/* Id, status and priority under the title */}
        <div className="ticket-title-meta mt-1.5 flex flex-wrap items-center gap-2">
          <span className="ticket-id inline-flex items-center gap-1">
            <Text size="sm" variant="muted" className="font-mono">
              {huddleTicketRef(ticket.id)}
            </Text>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Copy ticket id"
              title="Copy the full ticket id"
              onClick={() => void copyTicketId()}
            >
              <FontAwesomeIcon icon={idCopied ? faCheck : faCopy} className="h-3 w-3" />
            </Button>
            <span className="sr-only" aria-live="polite">
              {idCopied ? 'Ticket id copied' : ''}
            </span>
          </span>
          <Badge variant={statusVariant(ticket.status)} size="sm">
            {STATUS_OPTIONS.find((s) => s.value === ticket.status)?.label ?? ticket.status}
          </Badge>
          {ticket.priority && (
            <Badge variant={priorityVariant(ticket.priority)} size="sm">
              {ticket.priority.charAt(0).toUpperCase() + ticket.priority.slice(1)}
            </Badge>
          )}
          <span className="text-xs text-neutral-400">
            Opened {formatDate(ticket.createdAt)} by {creatorName}
          </span>
        </div>
      </div>

      <div className="ticket-detail-notices mb-3 space-y-2" aria-live="polite">
        {lock && (
          <Alert variant="warning">
            <AlertDescription>{lock.message}</AlertDescription>
          </Alert>
        )}
        {actionError && (
          <Alert variant="danger" role="alert">
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        )}
      </div>

      {/* Main layout: 2/3 + 1/3 */}
      <div className="ticket-detail-layout flex flex-col gap-3 lg:flex-row lg:items-start">
        {/* ── Left column: body ── */}
        <div className="ticket-detail-body min-w-0 flex-1 space-y-3">
          <LinkedIssueSection ticket={ticket} onChanged={setTicket} locked={locked} />

          {/* Description */}
          <Card>
            <CardContent className="ticket-description-section">
              <div className="ticket-description-header flex items-center justify-between mb-2">
                <Text size="sm" className="font-semibold text-neutral-700 dark:text-neutral-300">
                  Description
                </Text>
                {canEdit && !locked && !editingDesc && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Edit description"
                    onClick={() => {
                      setDescDraft(ticket.description ?? '');
                      setEditingDesc(true);
                    }}
                  >
                    <FontAwesomeIcon icon={faPen} size="sm" />
                  </Button>
                )}
              </div>

              {editingDesc ? (
                <div className="ticket-description-edit space-y-2">
                  <Textarea
                    aria-label="Ticket description"
                    rows={6}
                    value={descDraft}
                    placeholder="Supports Markdown (headings, lists, links, code, etc.)"
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                      setDescDraft(e.target.value)
                    }
                    className="w-full text-sm"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={saveDescription} disabled={saving}>
                      Save
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setEditingDesc(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="ticket-description-body">
                  {ticket.description ? (
                    <MarkdownContent content={ticket.description} />
                  ) : (
                    <Text size="sm" className="italic text-neutral-400">
                      No description provided.
                    </Text>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <TicketAttachmentsCard kind="ticket" ticketId={ticket.id} />

          {/* Activity: the ticket's history plus your own timer sessions */}
          <TicketActivityCard
            entries={activityEntries}
            note="Includes the time you logged on this ticket."
          />
        </div>

        {/* ── Right column: sidebar ── */}
        <aside
          className="ticket-detail-sidebar w-full lg:w-72 lg:shrink-0 space-y-3"
          aria-label="Ticket details sidebar"
        >
          <Card>
            <CardContent className="ticket-sidebar-fields space-y-3">
              {/* Status */}
              <div className="ticket-sidebar-field-status">
                <label
                  htmlFor="ticket-status"
                  className="font-semibold text-neutral-700 dark:text-neutral-300 text-xs"
                >
                  Status
                </label>
                <Select
                  id="ticket-status"
                  aria-label="Ticket status"
                  options={STATUS_OPTIONS}
                  value={ticket.status}
                  onValueChange={(val: string) => void handleStatusChange(val)}
                  disabled={locked}
                />
              </div>

              {/* Priority */}
              <div className="ticket-sidebar-field-priority">
                <label
                  htmlFor="ticket-priority"
                  className="font-semibold text-neutral-700 dark:text-neutral-300 text-xs"
                >
                  Priority
                </label>
                <Select
                  id="ticket-priority"
                  aria-label="Ticket priority"
                  options={PRIORITY_OPTIONS}
                  value={ticket.priority ?? 'none'}
                  onValueChange={(val: string) => void handlePriorityChange(val)}
                  disabled={locked}
                />
              </div>

              {/* Assignee */}
              <div className="ticket-sidebar-field-assignee">
                <label
                  htmlFor="ticket-assignee"
                  className="font-semibold text-neutral-700 dark:text-neutral-300 text-xs"
                >
                  Assignee
                </label>
                <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-neutral-200 p-3 dark:border-neutral-700">
                  {assigneeOptions.map((option) => {
                    const isUnassigned = option.value === '';
                    const currentAssignees = ticket.assignedTo ?? [];
                    const isChecked = isUnassigned
                      ? currentAssignees.length === 0
                      : currentAssignees.includes(option.value);

                    return (
                      <Checkbox
                        key={option.value}
                        size="sm"
                        label={option.label}
                        checked={isChecked}
                        disabled={locked}
                        onChange={(e) => {
                          if (isUnassigned) {
                            // When "Unassigned" is checked, clear all assignees.
                            // Unchecking it manually is a no-op.
                            if (e.target.checked) {
                              void handleAssigneesChange([]);
                            }
                          } else {
                            const newAssignees = e.target.checked
                              ? [...currentAssignees, option.value]
                              : currentAssignees.filter((id) => id !== option.value);
                            void handleAssigneesChange(newAssignees);
                          }
                        }}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Created by */}
              <div className="ticket-sidebar-field-creator mt-5">
                <Text
                  size="sm"
                  className="font-semibold text-neutral-700 dark:text-neutral-300 text-xs"
                >
                  Created By
                </Text>
                <div className="flex items-center gap-2 mt-2">
                  <UserAvatar size="xs" name={creatorName} />
                  <Text size="sm" className="text-neutral-700 dark:text-neutral-300">
                    {creatorName}
                  </Text>
                </div>
              </div>

              {/* Dates */}
              <div className="ticket-sidebar-dates space-y-1 mt-5">
                <Text
                  size="sm"
                  className="font-semibold text-neutral-700 dark:text-neutral-300 text-xs"
                >
                  Dates
                </Text>
                <Text size="sm" className="text-neutral-600 dark:text-neutral-400">
                  Created: {formatDate(ticket.createdAt)}
                </Text>
                {ticket.updatedAt && (
                  <Text size="sm" className="text-neutral-600 dark:text-neutral-400">
                    Updated: {formatDate(ticket.updatedAt)}
                  </Text>
                )}
              </div>

              {/* Reviewed */}
              {ticket.reviewedAt && (
                <div className="ticket-sidebar-reviewed">
                  <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400 mb-1">
                    Reviewed
                  </p>
                  <Text size="sm" className="text-neutral-600 dark:text-neutral-400">
                    {formatDate(ticket.reviewedAt)}
                  </Text>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Team badge */}
          {ticket.teamId && (
            <div className="ticket-sidebar-badges flex flex-wrap gap-1.5">
              <span className="inline-flex items-center rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                Team: {teams.find((t) => t.id === ticket.teamId)?.name ?? ticket.teamId}
              </span>
            </div>
          )}

          {/* Danger zone */}
          {canEdit && (
            <Card>
              <CardContent className="ticket-sidebar-danger">
                <Text size="sm" className="font-semibold text-red-500 mb-3">
                  Danger Zone
                </Text>
                <Button
                  variant="danger"
                  aria-label="Delete ticket"
                  className="w-full"
                  leftIcon={<FontAwesomeIcon icon={faTrash} size="sm" />}
                  onClick={() => void handleDelete()}
                  disabled={locked}
                >
                  Delete Ticket
                </Button>
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </AppPage>
  );
};
