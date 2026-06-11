import {
  faArrowLeft,
  faExternalLink,
  faPen,
  faTrash,
  faCheck,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Card, CardContent, Select, Spinner, Text, Textarea, Input } from '@mieweb/ui';
import React, { useEffect, useState } from 'react';
import {
  activityApi,
  teamApi,
  ticketApi,
  type ActivityLogItem,
  type TeamMember,
  type Ticket,
} from '../../lib/api';
import { useSession } from '../../lib/useSession';
import { useTeam } from '../../lib/TeamContext';
import { useRefresh } from '../../lib/RefreshContext';
import { AppPage } from '../../ui/AppPage';
import { MarkdownContent } from '../../ui/MarkdownContent';
import { useRouter } from '../../ui/router';
import { UserAvatar } from '../../ui/UserAvatar';
import { AttachmentsPanel } from '../clock/AttachmentsPanel';
import { PulseUploadButton } from '../media/PulseUploadButton';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'in-progress', label: 'In Progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'closed', label: 'Closed' },
];

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

function priorityColor(priority: string | null): string {
  switch (priority) {
    case 'critical':
      return 'border-red-500 bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300';
    case 'high':
      return 'border-orange-400 bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300';
    case 'medium':
      return 'border-yellow-400 bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300';
    case 'low':
      return 'border-blue-400 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300';
    default:
      return 'border-neutral-300 bg-neutral-50 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400';
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'open':
      return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
    case 'in-progress':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
    case 'blocked':
      return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
    case 'reviewed':
      return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200';
    case 'closed':
      return 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400';
    default:
      return 'bg-neutral-100 text-neutral-600';
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function activityLabel(event: ActivityLogItem): string {
  switch (event.type) {
    case 'ticket.created':
      return 'created this ticket';
    case 'ticket.updated':
      return 'updated this ticket';
    case 'ticket.deleted':
      return 'deleted this ticket';
    case 'ticket.status_changed':
      return `changed status to ${event.payload.status ?? ''}`;
    case 'ticket.assigned':
      return `assigned to ${event.payload.assigneeName ?? event.payload.assignedTo ?? 'someone'}`;
    default:
      return event.type.replace(/\./g, ' ');
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

interface TicketDetailPageProps {
  ticketId: string;
}

export const TicketDetailPage: React.FC<TicketDetailPageProps> = ({ ticketId }) => {
  const { navigate } = useRouter();
  const { user } = useSession();
  const { teams } = useTeam();

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [activity, setActivity] = useState<ActivityLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit state
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [attachmentRefresh, setAttachmentRefresh] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);

  // Load ticket + activity
  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      ticketApi.getTicket(ticketId),
      activityApi.getTicketActivity(ticketId, 50).catch(() => ({ events: [] })),
    ])
      .then(([t, a]) => {
        setTicket(t);
        setActivity(a.events);
        setTitleDraft(t.title);
        setDescDraft(t.description ?? '');
      })
      .catch(() => setError('Ticket not found or you do not have access.'))
      .finally(() => setLoading(false));
  }, [ticketId]);

  useRefresh(
    React.useCallback(async () => {
      setLoading(true);
      try {
        const [t, a] = await Promise.all([
          ticketApi.getTicket(ticketId),
          activityApi.getTicketActivity(ticketId, 50).catch(() => ({ events: [] })),
        ]);
        setTicket(t);
        setActivity(a.events);
      } catch {
        setError('Failed to refresh ticket.');
      } finally {
        setLoading(false);
      }
    }, [ticketId]),
  );

  // Load team members once we have the teamId
  useEffect(() => {
    if (!ticket?.teamId) return;
    teamApi
      .getMembers(ticket.teamId)
      .then(setMembers)
      .catch(() => setActionError('Failed to load team members. Assignee cannot be changed.'));
  }, [ticket?.teamId]);

  // ── Handlers ──

  const saveTitle = async () => {
    if (!ticket || !titleDraft.trim() || titleDraft === ticket.title) {
      setEditingTitle(false);
      return;
    }
    setSaving(true);
    try {
      const updated = await ticketApi.updateTicket(ticket.id, { title: titleDraft.trim() });
      setTicket(updated);
    } finally {
      setSaving(false);
      setEditingTitle(false);
    }
  };

  const saveDescription = async () => {
    if (!ticket) return;
    setSaving(true);
    try {
      const updated = await ticketApi.updateTicket(ticket.id, { description: descDraft });
      setTicket(updated);
    } finally {
      setSaving(false);
      setEditingDesc(false);
    }
  };

  const handleStatusChange = async (status: string) => {
    if (!ticket) return;
    const updated = await ticketApi.updateStatusPriority(ticket.id, { status });
    setTicket(updated);
  };

  const handlePriorityChange = async (priority: string) => {
    if (!ticket) return;
    const updated = await ticketApi.updateStatusPriority(ticket.id, { priority });
    setTicket(updated);
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
    } catch {
      setActionError('Failed to update assignees. You may not have permission.');
    }
  };

  const handleDelete = async () => {
    if (!ticket || !confirm(`Delete "${ticket.title}"?`)) return;
    await ticketApi.deleteTicket(ticket.id);
    navigate('/app/tickets');
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

  return (
    <AppPage>
      {/* Back navigation */}
      <div className="ticket-detail-back mb-4">
        <button
          aria-label="Back to tickets"
          className="p-2 rounded-full border border-neutral-200 dark:border-neutral-700 border-0.5 text-xs inline-flex items-center gap-2 text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 bg-neutral-100 dark:bg-neutral-800 font-medium"
          onClick={() => navigate('/app/tickets')}
        >
          <FontAwesomeIcon icon={faArrowLeft} size="sm" />
          TICKETS
        </button>
      </div>

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
          <div className="ticket-title-display flex items-center gap-2 group">
            <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
              {ticket.title}
            </h1>
            {canEdit && (
              <button
                aria-label="Edit title"
                className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-opacity"
                onClick={() => setEditingTitle(true)}
              >
                <FontAwesomeIcon icon={faPen} className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Status badge under title */}
        <div className="ticket-title-meta mt-1.5 flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(ticket.status)}`}
          >
            {STATUS_OPTIONS.find((s) => s.value === ticket.status)?.label ?? ticket.status}
          </span>
          {ticket.priority && (
            <span
              className={`inline-flex items-center rounded-full border px-1.5 py-px text-[11px] font-medium ${priorityColor(ticket.priority)}`}
            >
              {ticket.priority.charAt(0).toUpperCase() + ticket.priority.slice(1)}
            </span>
          )}
          <span className="text-xs text-neutral-400">
            Opened {formatDate(ticket.createdAt)} by {creatorName}
          </span>
        </div>
      </div>

      {/* Main layout: 2/3 + 1/3 */}
      <div className="ticket-detail-layout flex flex-col gap-3 lg:flex-row lg:items-start">
        {/* ── Left column: body ── */}
        <div className="ticket-detail-body min-w-0 flex-1 space-y-3">
          {/* GitHub link */}
          {ticket.github && (
            <Card>
              <CardContent className="ticket-github-link">
                <a
                  href={ticket.github}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`External link: ${ticket.github}`}
                  className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline dark:text-blue-400"
                >
                  <FontAwesomeIcon icon={faExternalLink} className="h-3 w-3" />
                  {ticket.github}
                </a>
              </CardContent>
            </Card>
          )}

          {/* Description */}
          <Card>
            <CardContent className="ticket-description-section">
              <div className="ticket-description-header flex items-center justify-between mb-2">
                <Text size="sm" className="font-semibold text-neutral-700 dark:text-neutral-300">
                  Description
                </Text>
                {canEdit && !editingDesc && (
                  <button
                    aria-label="Edit description"
                    className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                    onClick={() => {
                      setDescDraft(ticket.description ?? '');
                      setEditingDesc(true);
                    }}
                  >
                    <FontAwesomeIcon icon={faPen} size="sm" />
                  </button>
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

          {/* Attachments */}
          <Card>
            <CardContent className="ticket-attachments-section">
              <Text size="sm" className="font-semibold text-neutral-700 dark:text-neutral-300 mb-3">
                Attachments
              </Text>
              <AttachmentsPanel
                key={attachmentRefresh}
                kind="ticket"
                entityId={ticket.id}
                currentUserId={user?.id}
              />
              <PulseUploadButton
                ticketId={ticket.id}
                onUploadComplete={() => setAttachmentRefresh((n) => n + 1)}
              />
            </CardContent>
          </Card>

          {/* Activity log */}
          <Card>
            <CardContent className="ticket-activity-section">
              <Text size="sm" className="font-semibold text-neutral-700 dark:text-neutral-300 mb-3">
                Activity
              </Text>
              {activity.length === 0 ? (
                <Text size="sm" className="italic text-neutral-400">
                  No activity yet.
                </Text>
              ) : (
                <ol className="ticket-activity-list space-y-4" aria-label="Ticket activity">
                  {activity.map((event) => (
                    <li key={event.id} className="ticket-activity-item flex items-start gap-2">
                      <UserAvatar size="xs" name={event.actor.name ?? '?'} />
                      <div className="min-w-0">
                        <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
                          {event.actor.name}
                        </span>{' '}
                        <span className="text-sm text-neutral-500 dark:text-neutral-400">
                          {activityLabel(event)}
                        </span>
                        <div className="text-xs text-neutral-400 mt-0.5">
                          {formatDate(event.occurredAt)}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
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
                  options={[{ value: '', label: 'None' }, ...PRIORITY_OPTIONS]}
                  value={ticket.priority ?? ''}
                  onValueChange={(val: string) => void handlePriorityChange(val)}
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
                  {assigneeOptions.map((option) => (
                    <label
                      key={option.value}
                      className="flex items-center gap-2 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800 p-1 rounded"
                    >
                      <input
                        type="checkbox"
                        checked={ticket.assignedTo?.includes(option.value) ?? false}
                        onChange={(e) => {
                          const currentAssignees = ticket.assignedTo ?? [];
                          const newAssignees = e.target.checked
                            ? [...currentAssignees, option.value]
                            : currentAssignees.filter((id) => id !== option.value);
                          void handleAssigneesChange(newAssignees);
                        }}
                        className="h-4 w-4 rounded border-neutral-300 text-primary focus:ring-primary"
                      />
                      <span className="text-sm">{option.label}</span>
                    </label>
                  ))}
                </div>
                {actionError && <p className="mt-1 text-xs text-red-500">{actionError}</p>}
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
                <button
                  aria-label="Delete ticket"
                  onClick={() => void handleDelete()}
                  className="inline-flex items-center text-sm w-full justify-center gap-2 bg-destructive-500 dark:bg-destructive-900 text-white dark:text-destructive-100 hover:bg-destructive-600 p-2 font-medium rounded-md"
                >
                  <FontAwesomeIcon icon={faTrash} size="sm" />
                  Delete Ticket
                </button>
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </AppPage>
  );
};
