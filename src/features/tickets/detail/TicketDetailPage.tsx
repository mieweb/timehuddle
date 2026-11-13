import { faLink, faPen, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Alert,
  AlertDescription,
  Badge,
  type BadgeProps,
  Button,
  ButtonGroup,
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
import { Pencil } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  activityApi,
  teamApi,
  outsideIssueKey,
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
import { settingsPath } from '../../settings/settingsSections';
import { LinkedIssueSection } from '../link/LinkedIssueSection';
import { ticketLinkText } from '../link/ticketLinkStrings';
import { huddleTicketRef, invalidateRedmineCache, ticketKey } from '../sources';
import { carriedRefOf, linkRefOf } from '../ticketIds';

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
  return { issue: outsideIssueKey(issue), updated: issue.record.dates.updated ?? '' };
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
  const { allTeams: teams, organizations } = useTeam();

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [activity, setActivity] = useState<ActivityLogItem[]>([]);
  const [sessions, setSessions] = useState<TicketSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Set when the ticket can't be shown at all: forbidden vs. doesn't exist.
  const [unavailable, setUnavailable] = useState<NoAccessKind | null>(null);

  // Edit state
  const [editingTitle, setEditingTitle] = useState(false);
  // Set while Enter's save runs, so the field's blur doesn't drop the edit and
  // flash the old title before the new one lands.
  const savingTitle = useRef(false);
  // The heading's width when the edit opened, which the field takes.
  const titleDisplayRef = useRef<HTMLDivElement>(null);
  const [titleWidth, setTitleWidth] = useState<number | null>(null);
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
  // Relinked by a teammate since the page read the ticket: read it again, so
  // the page names the issue it now carries before showing that issue.
  const reloadTicket = useCallback(() => {
    ticketApi
      .getTicket(ticketId)
      .then(setTicket)
      .catch(() => setActionError('Could not load this ticket. Check your connection.'));
  }, [ticketId]);
  // The issue the ticket carries, read from its source: when there is one, its
  // status, priority, description and history are the source's.
  const outside = useOutsideIssue(
    ticketId,
    ticket?.linkedIssue ? ticketKey(ticket.linkedIssue.source, ticket.linkedIssue.id) : null,
    reloadTicket,
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
      if (await writeOutside({ title: titleDraft.trim() }, titleBase)) setEditingTitle(false);
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
  const writeOutside = async (
    edits: Parameters<typeof outside.write>[0],
    basedOn?: Parameters<typeof outside.write>[1],
  ) => {
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
      setStale(err instanceof ApiError && (err.code === 'stale' || err.code === 'stale-link'));
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
      if (await writeOutside({ body: descDraft }, descBase)) setEditingDesc(false);
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

  const loadingPage = (
    <AppPage>
      <div className="ticket-detail-loading flex items-center justify-center py-24">
        <Spinner />
      </div>
    </AppPage>
  );

  if (loading) return loadingPage;

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

  // A ticket carrying an outside issue is shown only to a viewer whose own key
  // can read the issue (#788): its title is the issue's subject.
  if (ticket.linkedIssue) {
    // `none`: the render before the hook's effect starts reading the issue.
    if (outside.state.kind === 'none' || outside.state.kind === 'loading') return loadingPage;
    if (outside.state.kind === 'denied') {
      return (
        <AppPage>
          <NoAccessState
            kind="forbidden"
            resource="linked-ticket"
            action={{
              label: ticketLinkText.goToSettings,
              onClick: () => navigate(settingsPath('integrations')),
            }}
          />
        </AppPage>
      );
    }
    if (outside.state.kind === 'unreachable') {
      return (
        <AppPage>
          <div className="ticket-detail-unreachable flex flex-col items-center gap-4 py-24">
            <Text role="alert">
              {outsideText.unreachable(sourceLabel(ticket.linkedIssue.source))}
            </Text>
            <Button variant="outline" onClick={() => void outside.reload()}>
              {outsideText.tryAgain}
            </Button>
          </div>
        </AppPage>
      );
    }
  }

  const team = teams.find((t) => t.id === ticket.teamId);
  // The ID the Tickets row shows: the issue it carries or links to, named by
  // its source (`timehuddle-58`, `RM0-214`), else the ticket's own.
  const prefixes =
    team?.sourcePrefixes ??
    organizations.find((org) => org.id === team?.orgId)?.sourcePrefixes ??
    [];
  const shownRef =
    carriedRefOf(ticket.linkedIssue ?? null, prefixes, null) ??
    linkRefOf(ticket, prefixes) ??
    huddleTicketRef(ticket, team?.ticketPrefix);

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
          <ButtonGroup orientation="horizontal" className="ticket-detail-top-actions gap-2">
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
            {/* Stays while the title is open, so nothing beside it shifts. */}
            {canEditText && (
              <Button
                variant="secondary"
                size="icon"
                aria-label="Edit title"
                title="Edit title"
                disabled={editingTitle}
                className="ticket-title-edit-button h-8 w-8 rounded-full p-0 [&_[data-slot=button-label]]:flex [&_[data-slot=button-label]]:items-center [&_[data-slot=button-label]]:justify-center"
                onClick={() => {
                  setTitleDraft(title);
                  setTitleBase(draftBaseNow());
                  setTitleWidth(titleDisplayRef.current?.offsetWidth ?? null);
                  setEditingTitle(true);
                }}
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            )}
          </ButtonGroup>
        }
      />

      {/* Full-width title section */}
      <div className="ticket-detail-title-section mb-6">
        <div className="ticket-title-row flex flex-wrap items-start justify-between gap-3">
          {editingTitle ? (
            // The field takes the heading's type and width, so the buttons beside
            // it stay where they were. Enter saves; leaving it (or Escape) drops the edit.
            <div
              className="ticket-title-edit min-w-0 max-w-full flex-1"
              style={titleWidth ? { flex: `1 1 ${titleWidth}px` } : undefined}
            >
              <Input
                aria-label="Ticket title"
                className="h-auto w-full py-1 text-2xl font-semibold"
                value={titleDraft}
                enterKeyHint="done"
                readOnly={saving}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitleDraft(e.target.value)}
                onKeyDown={(e: React.KeyboardEvent) => {
                  if (e.key === 'Enter' && !savingTitle.current) {
                    savingTitle.current = true;
                    void saveTitle().finally(() => {
                      savingTitle.current = false;
                    });
                  }
                  if (e.key === 'Escape') setEditingTitle(false);
                }}
                onBlur={() => {
                  if (!savingTitle.current) setEditingTitle(false);
                }}
                autoFocus
              />
            </div>
          ) : (
            <div ref={titleDisplayRef} className="ticket-title-display flex items-center gap-2">
              <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
                <span className="ticket-id-ref me-2 font-mono text-neutral-500 dark:text-neutral-400">
                  {shownRef}
                </span>
                {title}
              </h1>
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

        {/* Status and priority under the title */}
        <div className="ticket-title-meta mt-1.5 flex flex-wrap items-center gap-2">
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

              {/* Assignee: the source's for a carried ticket, shown as it has it.
                  Changing it from here is a follow-up (#757). */}
              <div className="ticket-sidebar-field-assignee">
                {carried ? (
                  <>
                    <Text
                      size="sm"
                      className="font-semibold text-neutral-700 dark:text-neutral-300 text-xs"
                    >
                      {outsideText.assigneeLabel(source ?? '')}
                    </Text>
                    <Text size="sm" className="text-neutral-700 dark:text-neutral-300">
                      {carried.record.assignees.map((person) => person.name).join(', ') ||
                        outsideText.noAssignee}
                    </Text>
                  </>
                ) : (
                  <>
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
                            disabled={locked || outside.state.kind === 'loading'}
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
                  </>
                )}
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
