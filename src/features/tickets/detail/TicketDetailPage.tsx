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
import { SOURCES } from '@timehuddle/ticket-sources';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  activityApi,
  teamApi,
  ticketApi,
  timerApi,
  type ActivityLogItem,
  type OutsideIssue,
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
import { huddleTicketRef, invalidateRedmineCache, ticketKey } from '../sources';

import { fromConversation, fromHuddleEvents, fromSessions, mergeByTime } from './activityEntries';
import { BackToTicketsButton } from './BackToTicketsButton';
import { outsideText } from './outsideStrings';
import { TicketActivityCard } from './TicketActivityCard';
import { TicketAttachmentsCard } from './TicketAttachmentsCard';
import { TicketQuickActions } from './TicketQuickActions';
import { useOutsideIssue } from './useOutsideIssue';

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

/** Which carried issue an edit was opened on, and that issue's version then. */
type DraftBase = { issue: string; updated: string } | null;

function baseOf(issue: OutsideIssue): NonNullable<DraftBase> {
  const ref = issue.record.ref;
  return {
    issue: `${issue.kind}:${ref?.server ?? ''}:${ref?.key ?? ''}`,
    updated: issue.record.dates.updated ?? '',
  };
}

/** A source's name ("Redmine") by its kind, for the page's labels. */
function sourceLabel(kind: string): string {
  return (SOURCES as Record<string, { label: string } | undefined>)[kind]?.label ?? kind;
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
  // Every team, not the selected org's: a ticket link can lead into another org.
  const { allTeams: teams } = useTeam();

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
  // What an open title or description edit was started against: the carried
  // issue (which one, and its `dates.updated`), or the ticket itself (null).
  // It is saved there and only there, checked against that version.
  const [titleBase, setTitleBase] = useState<DraftBase>(null);
  const [descBase, setDescBase] = useState<DraftBase>(null);
  // Set by Reload after a stale refusal: once the fresh issue arrives, an open
  // edit keeps its text and moves onto that version, so its next Save goes.
  const [rebaseDrafts, setRebaseDrafts] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // The carried issue changed in its source since it was read: offer a reload.
  const [stale, setStale] = useState(false);

  // Who is timing this ticket, if it is linked: while anyone is, the server
  // refuses changes to it. The timer may be a teammate's, which nothing pushes
  // to this page, so it is asked again in the background and after a refusal.
  const [lock, setLock] = useState<TicketLinkStatus['lock']>(null);
  const loadLock = useCallback(
    () =>
      ticketApi.lockStatus(ticketId).then(
        (status) => {
          setLock(status.lock);
          return true;
        },
        () => false,
      ),
    [ticketId],
  );
  const linkedIssueId = ticket?.linkedIssue?.id ?? null;
  // The issue the ticket carries, read from its source: when there is one, its
  // status, priority, description and history are the source's.
  const outside = useOutsideIssue(
    ticketId,
    ticket?.linkedIssue ? ticketKey(ticket.linkedIssue.source, ticket.linkedIssue.id) : null,
  );
  const carried = outside.state.kind === 'loaded' ? outside.state.issue : null;
  const { reload: reloadOutside } = outside;
  const carriedBase = carried ? baseOf(carried) : null;
  const carriedIssue = carriedBase?.issue ?? null;
  const carriedUpdated = carriedBase?.updated ?? null;
  useEffect(() => {
    if (!rebaseDrafts || carriedIssue === null || carriedUpdated === null) return;
    // Only onto the same issue: a draft for another one stays refused.
    const rebase = (base: DraftBase) =>
      base?.issue === carriedIssue ? { issue: carriedIssue, updated: carriedUpdated } : base;
    setTitleBase(rebase);
    setDescBase(rebase);
    setRebaseDrafts(false);
  }, [rebaseDrafts, carriedIssue, carriedUpdated]);
  useEffect(() => {
    void loadLock();
    const onRefetch = () => {
      void loadLock();
      void reloadOutside();
      // The session that just started or stopped belongs in the activity list.
      void timerApi
        .getTicketSessions(ticketId, 'huddle')
        .then(setSessions)
        .catch(() => {});
    };
    // Fired when the viewer's own timer starts or stops.
    window.addEventListener('tickets:refetch', onRefetch);
    return () => window.removeEventListener('tickets:refetch', onRefetch);
  }, [loadLock, reloadOutside, linkedIssueId, ticketId]);
  useBackgroundRefresh(loadLock);
  // The carried issue changes in its source with nothing to tell us, so it is
  // read again on return to the tab and every few minutes, but not while an
  // edit is open: the edit is checked against the version it started from.
  useBackgroundRefresh(reloadOutside, { paused: editingTitle || editingDesc });

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
        void reloadOutside();
      } catch {
        setError('Failed to refresh ticket.');
      } finally {
        setLoading(false);
      }
    }, [ticketId, loadLock, reloadOutside]),
  );

  // Load team members once we have the teamId
  useEffect(() => {
    if (!ticket?.teamId) return;
    teamApi
      .getMembers(ticket.teamId)
      .then(setMembers)
      .catch(() => setActionError('Failed to load team members. Assignee cannot be changed.'));
  }, [ticket?.teamId]);

  // Huddle's activity log, the viewer's own timer sessions and the carried
  // issue's history in its source, newest first.
  const activityEntries = useMemo(
    () =>
      mergeByTime(
        fromHuddleEvents(activity),
        fromSessions(sessions, 'You'),
        carried
          ? fromConversation(carried.record.conversation, {
              me: carried.me,
              source: sourceLabel(carried.kind),
            })
          : [],
      ),
    [activity, sessions, carried],
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

  /**
   * The version an edit opened now is checked against: the carried issue's,
   * or null for the ticket itself.
   */
  const draftBaseNow = (): DraftBase => (carried ? baseOf(carried) : null);

  /**
   * Whether an edit opened against `base` can still be saved there. When the
   * link changed, or the issue can't be read right now, the draft stays open
   * and the viewer is told, rather than saving it to the other place.
   */
  const draftStillFits = (base: DraftBase) => {
    const now = carried ? baseOf(carried) : null;
    if (base === null ? now === null : base.issue === now?.issue) return true;
    setActionError(outsideText.draftMoved);
    return false;
  };

  const saveTitle = async () => {
    if (!ticket || !draftStillFits(titleBase)) return;
    const current = carried ? carried.record.title : ticket.title;
    if (!titleDraft.trim() || titleDraft.trim() === current) {
      setEditingTitle(false);
      return;
    }
    if (titleBase !== null) {
      // The issue's title is the ticket's: it is written to the source.
      setSaving(true);
      if (await writeOutside({ title: titleDraft.trim() }, titleBase.updated))
        setEditingTitle(false);
      setSaving(false);
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

  /**
   * Write to the carried issue in its source, saying when it was refused or
   * stored otherwise. Resolves to whether the source took it.
   */
  const writeOutside = async (edits: Parameters<typeof outside.write>[0], basedOn?: string) => {
    if (!carried) return false;
    const source = sourceLabel(carried.kind);
    setActionError(null);
    setStale(false);
    try {
      const mismatches = await outside.write(edits, basedOn);
      // The Tickets list keeps Redmine rows cached for the session.
      invalidateRedmineCache();
      window.dispatchEvent(new CustomEvent('tickets:refetch'));
      if (mismatches.length) {
        // Not taken as sent: an open draft stays open, to correct or retry.
        setActionError(outsideText.notStored(source));
        return false;
      }
      return true;
    } catch (err) {
      setStale(err instanceof ApiError && err.code === 'stale');
      showFailure(err, outsideText.saveFailed(source));
      return false;
    }
  };

  const saveDescription = async () => {
    if (!ticket || !draftStillFits(descBase)) return;
    setSaving(true);
    setActionError(null);
    if (descBase !== null) {
      // A refused write keeps the draft open, so nothing typed is lost.
      if (await writeOutside({ body: descDraft }, descBase.updated)) setEditingDesc(false);
      setSaving(false);
      return;
    }
    try {
      setTicket(await ticketApi.updateTicket(ticket.id, { description: descDraft }));
    } catch (err) {
      showFailure(err, 'Failed to save the description.');
    } finally {
      setSaving(false);
      setEditingDesc(false);
    }
  };

  const handleStatusChange = async (status: string) => {
    if (!ticket) return;
    if (carried) {
      await writeOutside({ status });
      return;
    }
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

  const team = teams.find((t) => t.id === ticket.teamId);

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

  // A carried issue's own fields come from its source, where the viewer's
  // role there decides what they may change; a timer on the ticket doesn't.
  const source = carried ? sourceLabel(carried.kind) : null;
  const title = carried ? carried.record.title : ticket.title;
  const description = carried ? (carried.record.body?.text ?? '') : (ticket.description ?? '');
  // Not until the carried issue is read or has failed: where an edit goes
  // depends on it.
  const canEditText =
    outside.state.kind === 'loading' ? false : carried ? true : canEdit && !locked;

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
        <div className="ticket-title-row flex flex-wrap items-start justify-between gap-3">
          {editingTitle ? (
            <div className="ticket-title-edit flex min-w-0 flex-1 items-start gap-2">
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
                  setTitleDraft(title);
                }}
              >
                <FontAwesomeIcon icon={faXmark} />
              </Button>
            </div>
          ) : (
            <div className="ticket-title-display flex items-center gap-2">
              <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
                {title}
              </h1>
              {canEditText && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Edit title"
                  onClick={() => {
                    setTitleDraft(title);
                    setTitleBase(draftBaseNow());
                    setEditingTitle(true);
                  }}
                >
                  <FontAwesomeIcon icon={faPen} className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          )}
          <TicketQuickActions
            sourceId="huddle"
            id={ticket.id}
            title={title}
            linkedKey={
              ticket.linkedIssue
                ? ticketKey(ticket.linkedIssue.source, ticket.linkedIssue.id)
                : null
            }
          />
        </div>

        {/* Id, status and priority under the title */}
        <div className="ticket-title-meta mt-1.5 flex flex-wrap items-center gap-2">
          <span className="ticket-id inline-flex items-center gap-1">
            <Text size="sm" variant="muted" className="font-mono">
              {huddleTicketRef(ticket, team?.ticketPrefix)}
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
          {carried ? (
            <>
              <Badge variant={carried.record.status.isClosed ? 'default' : 'success'} size="sm">
                {carried.record.status.native}
              </Badge>
              {carried.record.priority && (
                <Badge variant="secondary" size="sm">
                  {carried.record.priority.native}
                </Badge>
              )}
            </>
          ) : (
            <>
              <Badge variant={statusVariant(ticket.status)} size="sm">
                {STATUS_OPTIONS.find((s) => s.value === ticket.status)?.label ?? ticket.status}
              </Badge>
              {ticket.priority && (
                <Badge variant={priorityVariant(ticket.priority)} size="sm">
                  {ticket.priority.charAt(0).toUpperCase() + ticket.priority.slice(1)}
                </Badge>
              )}
            </>
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
            {stale && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => {
                  setStale(false);
                  setActionError(null);
                  void outside.reload().then((ok) => ok && setRebaseDrafts(true));
                }}
              >
                {outsideText.reload}
              </Button>
            )}
          </Alert>
        )}
      </div>

      {/* Main layout: 2/3 + 1/3 */}
      <div className="ticket-detail-layout flex flex-col gap-3 lg:flex-row lg:items-start">
        {/* ── Left column: body ── */}
        <div className="ticket-detail-body min-w-0 flex-1 space-y-3">
          <LinkedIssueSection
            ticket={ticket}
            onChanged={setTicket}
            locked={locked}
            outside={outside.state}
          />

          {/* Description */}
          <Card>
            <CardContent className="ticket-description-section">
              <div className="ticket-description-header flex items-center justify-between mb-2">
                <div className="ticket-description-title flex items-baseline gap-2">
                  <Text size="sm" className="font-semibold text-neutral-700 dark:text-neutral-300">
                    Description
                  </Text>
                  {source && (
                    <Text size="xs" variant="muted">
                      {outsideText.descriptionFrom(source)}
                    </Text>
                  )}
                </div>
                {canEditText && !editingDesc && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Edit description"
                    onClick={() => {
                      setDescDraft(description);
                      setDescBase(draftBaseNow());
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
                  {description ? (
                    <MarkdownContent content={description} />
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
                  {source ? outsideText.statusLabel(source) : 'Status'}
                </label>
                {carried ? (
                  <Select
                    id="ticket-status"
                    aria-label={outsideText.statusLabel(source ?? '')}
                    options={carried.choices.status.map((status) => ({
                      value: status.id ?? status.native,
                      label: status.native,
                    }))}
                    value={carried.record.status.id ?? carried.record.status.native}
                    onValueChange={(val: string) => void handleStatusChange(val)}
                    disabled={carried.choices.status.length < 2}
                  />
                ) : (
                  <Select
                    id="ticket-status"
                    aria-label="Ticket status"
                    options={STATUS_OPTIONS}
                    value={ticket.status}
                    onValueChange={(val: string) => void handleStatusChange(val)}
                    // Until the carried issue is read, a change here could
                    // land on the ticket instead of the issue.
                    disabled={locked || outside.state.kind === 'loading'}
                  />
                )}
              </div>

              {/* Priority */}
              <div className="ticket-sidebar-field-priority">
                {carried ? (
                  <>
                    <Text
                      size="sm"
                      className="font-semibold text-neutral-700 dark:text-neutral-300 text-xs"
                    >
                      {outsideText.priorityLabel(source ?? '')}
                    </Text>
                    <Text size="sm" className="text-neutral-700 dark:text-neutral-300">
                      {carried.record.priority?.native ?? outsideText.noPriority}
                    </Text>
                  </>
                ) : (
                  <>
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
                      disabled={locked || outside.state.kind === 'loading'}
                    />
                  </>
                )}
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
                Team: {team?.name ?? ticket.teamId}
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
