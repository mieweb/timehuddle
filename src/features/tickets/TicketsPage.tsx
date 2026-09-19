/**
 * TicketsPage — the unified ticket table at /app/tickets.
 *
 * Shows tickets from every registered source (TimeHuddle's own tickets, a
 * connected Redmine instance) in one table. Source is a column and a filter,
 * not a mode: there is no view switcher. See `sources/README.md`.
 *
 * This page still owns TimeHuddle-specific mutations (create, edit, delete,
 * status, assignment) and the ticket timer; rows gate those controls on each
 * source's capabilities.
 */
import { faPlus, faSearch, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Button,
  Card,
  CardContent,
  Input,
  Modal,
  ModalBody,
  ModalClose,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Pagination,
  Select,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
  Textarea,
} from '@mieweb/ui';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ApiError,
  myBoardApi,
  redmineApi,
  teamApi,
  ticketApi,
  timerApi,
  shareTicketWithTimeharbor,
  type RedmineScope,
  type Team,
  type TeamMember,
  type Ticket,
} from '../../lib/api';
import { useTeam } from '../../lib/TeamContext';
import { getDdpClient, ddpDocToTicket } from '../../lib/ddp';
import { toLocalDateStr } from '../../lib/date';
import { useSession } from '../../lib/useSession';
import { useClockToggle } from '../../lib/useClockToggle';
import { useRunningTicket } from '../../lib/useRunningTicket';
import { useRefresh } from '../../lib/RefreshContext';
import { useRouter } from '../../ui/router';
import { AppPage } from '../../ui/AppPage';
import { EmptyState } from '../../ui/EmptyState';
import { UserAvatar } from '../../ui/UserAvatar';
import { AttachmentsPanel } from '../clock/AttachmentsPanel';
import { PulseUploadButton } from '../media/PulseUploadButton';
import { fetchGithubIssue, isGithubIssueUrl } from './githubIssue';
import { TicketBulkActionBar } from './TicketBulkActionBar';
import { TicketTable } from './TicketTable';
import { hasActiveFilters } from './ticketFilters';
import { huddleSource, useUnifiedTickets, type UnifiedTicket } from './sources';
import { useTicketTableView } from './useTicketTableView';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'in-progress', label: 'In Progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'closed', label: 'Completed' },
  { value: 'reviewed', label: 'Reviewed' },
];

const PRIORITY_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

function priorityLabelClass(priority: string): string {
  if (priority === 'critical')
    return 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400';
  if (priority === 'high')
    return 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400';
  if (priority === 'medium')
    return 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-400';
  return 'border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400';
}

async function fetchIssueTitle(url: string): Promise<string | null> {
  const issue = await fetchGithubIssue(url);
  return issue?.title ?? null;
}

export const TicketsPage: React.FC = () => {
  const { user } = useSession();
  const userId = user?.id ?? null;
  const { teams, selectedTeam, selectedTeamId, teamsReady } = useTeam();
  const { isClockedIn, clockIn } = useClockToggle();
  const { navigate, pathname } = useRouter();

  // Map from teamId → members for cross-team member lookups
  const [membersByTeam, setMembersByTeam] = useState<Map<string, TeamMember[]>>(new Map());

  // Which Redmine issues to pull in. "All" by default — narrowing to your own
  // issues is now the Assignee column filter, not a separate fetch scope.
  const [redmineScope] = useState<RedmineScope>('all');

  // Timer state — which ticket has the open timer (shared overnight-safe hook).
  // Keyed by `${sourceId}:${id}`, not id: a Redmine issue #42 and a Huddle
  // ticket are different rows that can share neither state nor identity.
  const runningTicket = useRunningTicket(true);
  const [timerLoadingKey, setTimerLoadingKey] = useState<string | null>(null);
  const [timerError, setTimerError] = useState<string | null>(null);
  const [pendingStartTicket, setPendingStartTicket] = useState<UnifiedTicket | null>(null);
  const [showClockInPrompt, setShowClockInPrompt] = useState(false);
  const [clockInPromptError, setClockInPromptError] = useState<string | null>(null);

  // Fetch members for all teams
  useEffect(() => {
    if (!teams.length) return;
    void Promise.all(
      teams.map(async (t) => {
        try {
          const members = await teamApi.getMembers(t.id);
          return [t.id, members] as [string, TeamMember[]];
        } catch {
          return [t.id, []] as [string, TeamMember[]];
        }
      }),
    ).then((entries) => setMembersByTeam(new Map(entries)));
  }, [teams]);

  // Flat deduplicated member list across all teams
  const allMembers = useMemo(() => {
    const seen = new Set<string>();
    const out: TeamMember[] = [];
    for (const members of membersByTeam.values()) {
      for (const m of members) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          out.push(m);
        }
      }
    }
    return out;
  }, [membersByTeam]);

  // Assignee name resolver (searches all members)
  const getAssigneeName = useCallback(
    (assignedTo: string | null) => {
      if (!assignedTo) return null;
      const member = allMembers.find((m) => m.id === assignedTo);
      return member ? member.name || member.email : null;
    },
    [allMembers],
  );

  // ── Unified ticket sources ──

  const sourceCtx = useMemo(
    () => ({
      userId,
      teams: teams.map((t: Team) => ({ id: t.id, name: t.name })),
      resolveMemberName: getAssigneeName,
      redmineScope,
    }),
    [userId, teams, getAssigneeName, redmineScope],
  );

  const {
    tickets: allTickets,
    loading: ticketsLoading,
    errors: sourceErrors,
    refetch,
    setSourceItems,
  } = useUnifiedTickets(sourceCtx);

  // Pull-to-refresh handler — only while this page is the active route. It
  // stays mounted (hidden) behind other routes, so registering unconditionally
  // would hijack the visible page's refresh handler.
  useRefresh(refetch, pathname === '/app/tickets');

  // Stable key derived from sorted team IDs — the subscription only reconnects
  // when the actual set of teams changes, not on every new array reference.
  const teamIdsKey = useMemo(
    () =>
      teams
        .map((t: Team) => t.id)
        .sort()
        .join(','),
    [teams],
  );

  // Real-time updates via Meteor DDP (oplog-backed publication `tickets.byTeam`).
  // Any write to the shared Mongo (Fastify REST, Meteor methods, wormhole REST,
  // MCP agents) is pushed here automatically — no broadcast code on any server.
  //
  // This replaces only the `huddle` partition: other sources have their own
  // update paths and must not be touched by a Huddle push.
  useEffect(() => {
    if (!teamIdsKey || !userId) return;

    const teamIds = teamIdsKey.split(',');
    const ddp = getDdpClient();

    const offChange = ddp.onCollectionChange('tickets', () => {
      const liveDocs = ddp.docs('tickets').map(ddpDocToTicket);
      setSourceItems(
        'huddle',
        liveDocs.map((doc) => huddleSource.toUnified(doc, sourceCtxRef.current)),
      );
    });
    const unsubscribe = ddp.subscribe('tickets.byTeam', [teamIds]);

    return () => {
      offChange();
      unsubscribe();
    };
  }, [teamIdsKey, userId, setSourceItems]);

  // Read inside the DDP callback so live pushes normalize against the current
  // team/member data without resubscribing every time that data changes.
  const sourceCtxRef = React.useRef(sourceCtx);
  sourceCtxRef.current = sourceCtx;

  // ── Real-time timer updates live inside useRunningTicket ──

  // Listen for external refetch requests (e.g., from CommandPalette or clock operations)
  useEffect(() => {
    const onRefetch = () => refetch();
    window.addEventListener('tickets:refetch', onRefetch);
    return () => window.removeEventListener('tickets:refetch', onRefetch);
  }, [refetch]);

  // Mutation loading states
  const [createLoading, setCreateLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  // Create state
  const [showCreate, setShowCreate] = useState(false);
  const [showNoTeamDialog, setShowNoTeamDialog] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createGithub, setCreateGithub] = useState('');
  const [createTitleFetching, setCreateTitleFetching] = useState(false);
  const createFetchTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tickets tab vs My Board tab — same URL, local state only (M2.1 retired the
  // heading-dropdown pattern; this is real tabs instead).
  const [activeView, setActiveView] = useState<'tickets' | 'my-board'>('tickets');

  // My Board membership — identity only (`${sourceId}:${id}` keys, matching
  // UnifiedTicket.key). Display fields are resolved by filtering allTickets,
  // never snapshotted server-side (Core Model Data Discipline).
  const [boardKeys, setBoardKeys] = useState<Set<string>>(new Set());
  useEffect(() => {
    void myBoardApi.list().then((entries) => {
      setBoardKeys(new Set(entries.map((e) => `${e.sourceId}:${e.ticketId}`)));
    });
  }, []);
  const boardTickets = useMemo(
    () => allTickets.filter((t) => boardKeys.has(t.key)),
    [allTickets, boardKeys],
  );

  // Whether the user has linked a Redmine account, so the board can say *why*
  // its Redmine rows are missing instead of silently showing a short list.
  const [redmineConnected, setRedmineConnected] = useState<boolean | null>(null);
  useEffect(() => {
    void redmineApi
      .status()
      .then((status) => setRedmineConnected(status.connected))
      .catch(() => setRedmineConnected(null));
  }, []);

  /**
   * Board entries with no ticket behind them. A board row is identity-only, so
   * it outlives the ticket it points at: a Redmine issue is unreachable while
   * the account is unlinked, and a Huddle ticket may have been deleted.
   */
  const unresolvedBoardNotice = useMemo(() => {
    const missing = [...boardKeys].filter((key) => !allTickets.some((t) => t.key === key));
    if (ticketsLoading || missing.length === 0) return null;
    const redmineCount = missing.filter((key) => key.startsWith('redmine:')).length;
    if (redmineCount > 0 && redmineConnected === false) {
      return `Connect your Redmine account in Settings to see ${redmineCount} Redmine issue${redmineCount === 1 ? '' : 's'} on your board.`;
    }
    return `${missing.length} ticket${missing.length === 1 ? '' : 's'} on your board ${missing.length === 1 ? 'is' : 'are'} no longer available.`;
  }, [boardKeys, allTickets, ticketsLoading, redmineConnected]);
  // Superset lookup for resolving a selection key (Tickets or My Board tab)
  // back to its ticket, e.g. to gate the bulk Delete button.
  const ticketByKey = useMemo(() => new Map(allTickets.map((t) => [t.key, t])), [allTickets]);

  // Search/filter/sort/paginate/select — one independent pipeline per tab, so
  // switching tabs never resets or leaks the other tab's state.
  const ticketsView = useTicketTableView(allTickets);
  const boardView = useTicketTableView(boardTickets);
  const {
    searchQuery,
    setSearchQuery,
    filters,
    setFilters,
    clearFilters,
    sort,
    onSortChange: handleSortChange,
    showClosed,
    setShowClosed,
    openFilterMenu,
    onOpenFilterMenuChange: setOpenFilterMenu,
    page,
    setPage,
    containerRef: tableAreaRef,
    searchFilteredTickets,
    openCount,
    closedCount,
    sortedTickets,
    pageTickets,
    totalPages,
    selectedKeys,
    onSelectedChange: handleSelectedChange,
    onSelectAllChange: handleSelectAllChange,
  } = ticketsView;

  // Delete state — a list so the same confirm modal covers single-row (⋮ menu)
  // and bulk (action bar) delete without two code paths.
  const [deleteIds, setDeleteIds] = useState<string[]>([]);

  // Edit modal state (creator only)
  const [editTicket, setEditTicket] = useState<Ticket | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editGithub, setEditGithub] = useState('');
  const [editAssignees, setEditAssignees] = useState<string[]>([]);
  const [editPriority, setEditPriority] = useState('');
  const [titleFetching, setTitleFetching] = useState(false);
  const editFetchTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Change status modal (any team member)
  const [changeStatusTicket, setChangeStatusTicket] = useState<UnifiedTicket | null>(null);
  const [changeStatusValue, setChangeStatusValue] = useState('');
  const [changeStatusSaving, setChangeStatusSaving] = useState(false);

  // Ticket details modal (read-only)
  const [detailsTicket, setDetailsTicket] = useState<Ticket | null>(null);
  const [detailsAttachmentRefresh, setDetailsAttachmentRefresh] = useState(0);

  // Member options for assignee select in the edit modal
  const memberOptions = useMemo(() => {
    const teamId = selectedTeamId ?? teams[0]?.id;
    const members = teamId ? (membersByTeam.get(teamId) ?? []) : [];
    return members.map((m) => ({ value: m.id, label: m.name || m.email }));
  }, [membersByTeam, selectedTeamId, teams]);

  const ticketCardRef = React.useRef<HTMLDivElement>(null);
  const boardCardRef = React.useRef<HTMLDivElement>(null);

  // ── Handlers ──

  // ── Ticket timers (started only from My Board — M3 D1) ──

  /**
   * Turn a rejected timer start into something the user can act on. The shift
   * gate is the common one: `isClockedIn` can be stale (another tab clocked
   * out, the 8h auto-clockout fired), so the server's answer is authoritative.
   */
  const timerErrorMessage = (err: unknown): string => {
    const code = err instanceof ApiError ? err.code : undefined;
    if (code === 'no-active-shift') return 'Clock in to start a ticket timer.';
    if (code === 'not-connected')
      return 'Connect your Redmine account in Settings to time this issue.';
    if (code === 'unreachable' || code === 'invalid-key')
      return 'Could not reach Redmine to start this timer.';
    return 'Could not start the timer. Please try again.';
  };

  const startTimerForTicket = useCallback(async (ticket: UnifiedTicket) => {
    setTimerLoadingKey(ticket.key);
    setTimerError(null);
    try {
      const result = await timerApi.createEntry({
        ticketId: ticket.id,
        source: ticket.sourceId,
        date: toLocalDateStr(new Date()),
        startNow: true,
        notifyAdmins: false,
      });

      if (result.session) {
        // Hook refreshes via DDP / tickets:refetch once the open timer lands.
        window.dispatchEvent(new CustomEvent('tickets:refetch'));
      }
    } catch (err) {
      setTimerError(timerErrorMessage(err));
    } finally {
      setTimerLoadingKey(null);
    }
  }, []);

  const handleToggleTimer = useCallback(
    async (ticket: UnifiedTicket) => {
      // Starting a second ticket's timer auto-stops the first (M3 D5) — that is
      // `closeRunningSession` server-side, and needs no confirmation here.
      if (runningTicket?.key === ticket.key && runningTicket.sessionId) {
        setTimerLoadingKey(ticket.key);
        setTimerError(null);
        try {
          await timerApi.stopSession(runningTicket.sessionId);
          window.dispatchEvent(new CustomEvent('tickets:refetch'));
        } catch {
          setTimerError('Could not stop the timer. Please try again.');
        } finally {
          setTimerLoadingKey(null);
        }
        return;
      }

      // A ticket timer requires an active shift (M3 D3). Offer to clock in
      // rather than letting the server reject the start.
      if (!isClockedIn) {
        setPendingStartTicket(ticket);
        setClockInPromptError(null);
        setShowClockInPrompt(true);
        return;
      }

      await startTimerForTicket(ticket);
    },
    [runningTicket, isClockedIn, startTimerForTicket],
  );

  const handleClockInAndStart = useCallback(async () => {
    if (!pendingStartTicket) return;

    if (!selectedTeamId) {
      setClockInPromptError('Select a team before clocking in.');
      return;
    }

    setClockInPromptError(null);
    const clockedIn = await clockIn();
    if (!clockedIn) {
      // Plan-first gate: today's plan post is required before clocking in.
      setClockInPromptError('Write today’s plan first — see the Clock page or Huddle.');
      return;
    }

    const ticket = pendingStartTicket;
    setShowClockInPrompt(false);
    setPendingStartTicket(null);

    await startTimerForTicket(ticket);
  }, [pendingStartTicket, selectedTeamId, clockIn, startTimerForTicket]);

  const handleCreate = useCallback(async () => {
    if (!createTitle.trim()) return;
    if (!selectedTeam) {
      setShowCreate(false);
      setShowNoTeamDialog(true);
      return;
    }
    setCreateLoading(true);
    try {
      await ticketApi.createTicket({
        teamId: selectedTeam.id,
        title: createTitle.trim(),
        github: createGithub.trim() || undefined,
      });
      setCreateTitle('');
      setCreateGithub('');
      setShowCreate(false);
      void refetch();
    } finally {
      setCreateLoading(false);
    }
  }, [createTitle, createGithub, refetch, selectedTeam]);

  // The list only carries the normalized shape, so fetch the full ticket the
  // edit form needs (description, assignees) when the modal actually opens.
  const openEditModal = useCallback(async (unified: UnifiedTicket) => {
    if (!unified.capabilities.edit) return;
    const ticket = await ticketApi.getTicket(unified.id);
    setEditTicket(ticket);
    setEditTitle(ticket.title);
    setEditDescription(ticket.description || '');
    setEditGithub(ticket.github || '');
    setEditAssignees(ticket.assignedTo ?? []);
    setEditPriority(ticket.priority || 'none');
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editTicket || !editTitle.trim()) return;
    setEditSaving(true);
    try {
      await ticketApi.updateTicket(editTicket.id, {
        title: editTitle.trim(),
        description: editDescription.trim() || undefined,
        github: editGithub.trim() || undefined,
      });
      const currentAssignees = editTicket.assignedTo ?? [];
      const hasChanged =
        editAssignees.length !== currentAssignees.length ||
        !editAssignees.every((id) => currentAssignees.includes(id));
      if (hasChanged) {
        await ticketApi.assignTicket(editTicket.id, editAssignees);
      }
      if (editPriority !== (editTicket.priority || 'none')) {
        await ticketApi.updateStatusPriority(editTicket.id, {
          priority: editPriority,
        });
      }
      setEditTicket(null);
      void refetch();
    } finally {
      setEditSaving(false);
    }
  }, [editTicket, editTitle, editDescription, editGithub, editAssignees, editPriority, refetch]);

  const handleSaveStatus = useCallback(async () => {
    if (!changeStatusTicket || !changeStatusValue) return;
    setChangeStatusSaving(true);
    try {
      await ticketApi.updateStatusPriority(changeStatusTicket.id, { status: changeStatusValue });
      setChangeStatusTicket(null);
      void refetch();
    } finally {
      setChangeStatusSaving(false);
    }
  }, [changeStatusTicket, changeStatusValue, refetch]);

  const handleDelete = useCallback(async () => {
    if (deleteIds.length === 0) return;
    setDeleteLoading(true);
    try {
      await Promise.all(deleteIds.map((id) => ticketApi.deleteTicket(id)));
      setDeleteIds([]);
      ticketsView.clearSelection();
      boardView.clearSelection();
      void refetch();
    } finally {
      setDeleteLoading(false);
    }
  }, [deleteIds, refetch, ticketsView, boardView]);

  // Ticket is eligible for the caller to delete — the same gate the row's ⋮
  // menu already applies (`capabilities.delete && isCreator`).
  const canDelete = useCallback(
    (ticket: UnifiedTicket) => ticket.capabilities.delete && ticket.createdBy?.id === userId,
    [userId],
  );

  // The bulk Delete button is disabled unless every currently selected
  // ticket (on whichever tab) is eligible.
  const canDeleteSelection = useCallback(
    (selectedKeys: Set<string>) =>
      selectedKeys.size > 0 &&
      [...selectedKeys].every((key) => {
        const ticket = ticketByKey.get(key);
        return ticket ? canDelete(ticket) : false;
      }),
    [ticketByKey, canDelete],
  );

  const handleBulkDeleteRequest = useCallback(
    (selectedKeys: Set<string>) => {
      setDeleteIds(
        [...selectedKeys].map((key) => ticketByKey.get(key)?.id).filter((id): id is string => !!id),
      );
    },
    [ticketByKey],
  );

  const handleMoveToBoard = useCallback(() => {
    const keys = [...ticketsView.selectedKeys];
    const refs = keys.map((key) => {
      const [sourceId, ticketId] = key.split(/:(.*)/s);
      return { sourceId, ticketId };
    });
    void myBoardApi.addMany(refs).then(() => {
      setBoardKeys((prev) => new Set([...prev, ...keys]));
      ticketsView.clearSelection();
    });
  }, [ticketsView]);

  const handleRemoveFromBoard = useCallback(() => {
    const keys = [...boardView.selectedKeys];
    const refs = keys.map((key) => {
      const [sourceId, ticketId] = key.split(/:(.*)/s);
      return { sourceId, ticketId };
    });
    void myBoardApi.removeMany(refs).then(() => {
      setBoardKeys((prev) => {
        const next = new Set(prev);
        for (const key of keys) next.delete(key);
        return next;
      });
      boardView.clearSelection();
    });
  }, [boardView]);

  const noFocusRingClass =
    'ring-0 focus:ring-0 focus-visible:ring-0 focus:outline-none focus-visible:outline-none focus:border-blue-300 focus-visible:border-blue-300';

  return (
    <AppPage fill width="full">
      <h1 className="sr-only">Tickets</h1>

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <Tabs
          value={activeView}
          onValueChange={(v) => setActiveView(v as 'tickets' | 'my-board')}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList className="mb-3 w-fit shrink-0">
            <TabsTrigger value="tickets">Tickets</TabsTrigger>
            <TabsTrigger value="my-board">My Board</TabsTrigger>
          </TabsList>

          {/* ── Tickets tab ── */}
          <TabsContent
            value="tickets"
            forceMount
            className="mt-0 flex min-h-0 flex-1 flex-col gap-3"
          >
            {/* ── Header: New Ticket + Search ── */}
            <div className="sticky top-0 z-20 -mx-4 border-b border-neutral-200 bg-neutral-50/95 px-4 py-2 backdrop-blur supports-backdrop-filter:bg-neutral-50/80 dark:border-neutral-800 dark:bg-neutral-950/95 dark:supports-backdrop-filter:bg-neutral-950/80 md:static md:z-auto md:mx-0 md:border-0 md:bg-transparent md:px-0 md:py-0">
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  leftIcon={<FontAwesomeIcon icon={faPlus} />}
                  // Teams arrive asynchronously, so selectedTeam is null on first
                  // paint even for users who have one. Without this guard an early
                  // click reports "No team available" to a user who has a team.
                  disabled={!teamsReady}
                  onClick={() => {
                    if (!selectedTeam) {
                      setShowNoTeamDialog(true);
                      return;
                    }
                    setShowCreate(true);
                  }}
                  className="shrink-0 rounded-lg"
                >
                  New Ticket
                </Button>

                <div className="relative min-w-0 flex-1">
                  <FontAwesomeIcon
                    icon={faSearch}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-neutral-400"
                  />
                  <Input
                    label="Search"
                    hideLabel
                    placeholder="Search tickets…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className={`pl-8 rounded-lg ${noFocusRingClass}`}
                    size="sm"
                  />
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  <Text size="xs" variant="muted" className="hidden whitespace-nowrap sm:block">
                    {ticketsLoading ? '…' : `${openCount} open · ${closedCount} closed`}
                  </Text>
                  <Switch
                    size="sm"
                    label="Closed"
                    labelPosition="left"
                    checked={showClosed}
                    onCheckedChange={setShowClosed}
                  />
                  {hasActiveFilters(filters) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="whitespace-nowrap px-2 text-xs"
                      onClick={clearFilters}
                    >
                      Clear filters
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Create ticket form */}
            {showCreate && (
              <Card
                padding="sm"
                className="border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20"
              >
                <CardContent>
                  <div className="flex items-center justify-between pl-2">
                    <Text size="sm" weight="semibold">
                      New Ticket
                    </Text>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowCreate(false)}
                      aria-label="Close"
                      className="h-8 w-8 rounded-full hover:bg-blue-100 dark:hover:bg-blue-800"
                    >
                      <FontAwesomeIcon icon={faXmark} className="text-xs" />
                    </Button>
                  </div>
                  <form
                    className="mt-2 space-y-2"
                    onSubmit={(e: React.FormEvent<HTMLFormElement>) => {
                      e.preventDefault();
                      if (!createTitle.trim()) return;
                      void handleCreate();
                    }}
                    onKeyDown={(e: React.KeyboardEvent<HTMLFormElement>) => {
                      if (e.key !== 'Escape') return;
                      e.preventDefault();
                      setShowCreate(false);
                    }}
                  >
                    <Input
                      label="Title"
                      hideLabel
                      size="sm"
                      placeholder={createTitleFetching ? 'Fetching title…' : 'Ticket title'}
                      value={createTitle}
                      onChange={(e) => setCreateTitle(e.target.value)}
                      className={noFocusRingClass}
                      autoFocus
                      disabled={createTitleFetching}
                      onPaste={(e) => {
                        const text = (
                          e.clipboardData ?? (e.nativeEvent as ClipboardEvent).clipboardData
                        )
                          ?.getData('text')
                          ?.trim();
                        if (!text || !isGithubIssueUrl(text)) return;
                        e.preventDefault();
                        setCreateGithub(text);
                        setCreateTitleFetching(true);
                        void fetchIssueTitle(text).then((title) => {
                          if (title) setCreateTitle(title);
                          setCreateTitleFetching(false);
                        });
                      }}
                    />
                    <Input
                      label="GitHub URL"
                      hideLabel
                      size="sm"
                      type="url"
                      placeholder="GitHub URL (optional)"
                      value={createGithub}
                      className={noFocusRingClass}
                      onChange={(e) => {
                        const url = e.target.value;
                        setCreateGithub(url);
                        if (createFetchTimer.current) clearTimeout(createFetchTimer.current);
                        if (isGithubIssueUrl(url)) {
                          createFetchTimer.current = setTimeout(() => {
                            setCreateTitleFetching(true);
                            void fetchIssueTitle(url).then((title) => {
                              if (title) setCreateTitle(title);
                              setCreateTitleFetching(false);
                            });
                          }, 300);
                        }
                      }}
                    />
                    <Button
                      variant="primary"
                      size="sm"
                      type="submit"
                      isLoading={createLoading}
                      loadingText="Creating…"
                      disabled={!createTitle.trim() || !selectedTeam}
                    >
                      Create Ticket
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}

            {selectedKeys.size > 0 && (
              <TicketBulkActionBar
                selectedCount={selectedKeys.size}
                onDeselectAll={ticketsView.clearSelection}
                canDeleteSelected={canDeleteSelection(selectedKeys)}
                onDelete={() => handleBulkDeleteRequest(selectedKeys)}
                primaryLabel="Move to My Board"
                onPrimaryAction={handleMoveToBoard}
              />
            )}

            {/* ── Unified ticket table ── */}
            <Card ref={ticketCardRef} padding="none" className="flex min-h-0 flex-1 flex-col">
              {/* Fills the remaining height; only the columns scroll, horizontally. */}
              <div ref={tableAreaRef} className="min-h-0 flex-1 overflow-hidden">
                <TicketTable
                  tickets={pageTickets}
                  optionSource={searchFilteredTickets}
                  loading={ticketsLoading}
                  errors={sourceErrors}
                  isCreator={(t) => t.createdBy?.id === userId}
                  sort={sort}
                  onSortChange={handleSortChange}
                  filters={filters}
                  onFiltersChange={setFilters}
                  openMenuId={openFilterMenu}
                  onOpenMenuChange={setOpenFilterMenu}
                  boundaryRef={ticketCardRef}
                  selectedKeys={selectedKeys}
                  onSelectedChange={handleSelectedChange}
                  onSelectAllChange={handleSelectAllChange}
                  runningTicketKey={runningTicket?.key ?? null}
                  timerLoadingKey={timerLoadingKey}
                  totalCount={sortedTickets.length}
                  showClosed={showClosed}
                  onToggleTimer={handleToggleTimer}
                  onEditRequest={(t) => void openEditModal(t)}
                  onDeleteRequest={(t) => setDeleteIds([t.id])}
                  onChangeStatusRequest={(t) => {
                    setChangeStatusTicket(t);
                    setChangeStatusValue(t.status.native || 'open');
                  }}
                  onShareWithTimeharbor={async (t, shared) => {
                    try {
                      await shareTicketWithTimeharbor(t.id, shared);
                      refetch();
                    } catch {
                      // Silently ignore — user can retry
                    }
                  }}
                  emptyState={
                    <EmptyState
                      title={
                        searchQuery || hasActiveFilters(filters)
                          ? 'No tickets match your filters'
                          : showClosed
                            ? 'No closed tickets'
                            : 'No open tickets'
                      }
                      description={
                        !searchQuery && !hasActiveFilters(filters) && !showClosed
                          ? 'Create one to get started.'
                          : undefined
                      }
                    />
                  }
                />
              </div>

              {totalPages > 1 && (
                <div className="flex shrink-0 items-center justify-between gap-2 border-t border-neutral-200 px-4 py-2 dark:border-neutral-700">
                  <Text size="xs" variant="muted">
                    {selectedKeys.size > 0
                      ? `${selectedKeys.size} selected`
                      : `${sortedTickets.length} ticket${sortedTickets.length === 1 ? '' : 's'}`}
                  </Text>
                  <Pagination
                    page={page}
                    totalPages={totalPages}
                    onPageChange={setPage}
                    size="sm"
                    label="Ticket pages"
                  />
                </div>
              )}
            </Card>
          </TabsContent>

          {/* ── My Board tab ── */}
          <TabsContent
            value="my-board"
            forceMount
            className="mt-0 flex min-h-0 flex-1 flex-col gap-3"
          >
            <div className="sticky top-0 z-20 -mx-4 border-b border-neutral-200 bg-neutral-50/95 px-4 py-2 backdrop-blur supports-backdrop-filter:bg-neutral-50/80 dark:border-neutral-800 dark:bg-neutral-950/95 dark:supports-backdrop-filter:bg-neutral-950/80 md:static md:z-auto md:mx-0 md:border-0 md:bg-transparent md:px-0 md:py-0">
              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <FontAwesomeIcon
                    icon={faSearch}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-neutral-400"
                  />
                  <Input
                    label="Search"
                    hideLabel
                    placeholder="Search My Board…"
                    value={boardView.searchQuery}
                    onChange={(e) => boardView.setSearchQuery(e.target.value)}
                    className={`pl-8 rounded-lg ${noFocusRingClass}`}
                    size="sm"
                  />
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  <Text size="xs" variant="muted" className="hidden whitespace-nowrap sm:block">
                    {ticketsLoading
                      ? '…'
                      : `${boardView.openCount} open · ${boardView.closedCount} closed`}
                  </Text>
                  <Switch
                    size="sm"
                    label="Closed"
                    labelPosition="left"
                    checked={boardView.showClosed}
                    onCheckedChange={boardView.setShowClosed}
                  />
                  {hasActiveFilters(boardView.filters) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="whitespace-nowrap px-2 text-xs"
                      onClick={boardView.clearFilters}
                    >
                      Clear filters
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {boardView.selectedKeys.size > 0 && (
              <TicketBulkActionBar
                selectedCount={boardView.selectedKeys.size}
                onDeselectAll={boardView.clearSelection}
                canDeleteSelected={canDeleteSelection(boardView.selectedKeys)}
                onDelete={() => handleBulkDeleteRequest(boardView.selectedKeys)}
                primaryLabel="Remove from My Board"
                onPrimaryAction={handleRemoveFromBoard}
              />
            )}

            {/* Timer failures and unresolvable board entries, announced politely. */}
            <div role="status" aria-live="polite" className="empty:hidden">
              {timerError && (
                <Text size="xs" className="block text-danger">
                  {timerError}
                </Text>
              )}
              {unresolvedBoardNotice && (
                <Text size="xs" variant="muted" className="block">
                  {unresolvedBoardNotice}
                </Text>
              )}
            </div>

            {/* ── My Board table ── */}
            <Card ref={boardCardRef} padding="none" className="flex min-h-0 flex-1 flex-col">
              <div ref={boardView.containerRef} className="min-h-0 flex-1 overflow-hidden">
                <TicketTable
                  tickets={boardView.pageTickets}
                  optionSource={boardView.searchFilteredTickets}
                  loading={ticketsLoading}
                  errors={sourceErrors}
                  isCreator={(t) => t.createdBy?.id === userId}
                  sort={boardView.sort}
                  onSortChange={boardView.onSortChange}
                  filters={boardView.filters}
                  onFiltersChange={boardView.setFilters}
                  openMenuId={boardView.openFilterMenu}
                  onOpenMenuChange={boardView.onOpenFilterMenuChange}
                  boundaryRef={boardCardRef}
                  selectedKeys={boardView.selectedKeys}
                  onSelectedChange={boardView.onSelectedChange}
                  onSelectAllChange={boardView.onSelectAllChange}
                  runningTicketKey={runningTicket?.key ?? null}
                  timerLoadingKey={timerLoadingKey}
                  totalCount={boardView.sortedTickets.length}
                  showClosed={boardView.showClosed}
                  onToggleTimer={handleToggleTimer}
                  showTimerColumn
                  onEditRequest={(t) => void openEditModal(t)}
                  onDeleteRequest={(t) => setDeleteIds([t.id])}
                  onChangeStatusRequest={(t) => {
                    setChangeStatusTicket(t);
                    setChangeStatusValue(t.status.native || 'open');
                  }}
                  onShareWithTimeharbor={async (t, shared) => {
                    try {
                      await shareTicketWithTimeharbor(t.id, shared);
                      refetch();
                    } catch {
                      // Silently ignore — user can retry
                    }
                  }}
                  emptyState={
                    <EmptyState
                      title={
                        boardView.searchQuery || hasActiveFilters(boardView.filters)
                          ? 'No tickets match your filters'
                          : boardView.showClosed
                            ? 'No closed tickets on your board'
                            : 'Your board is empty'
                      }
                      description={
                        unresolvedBoardNotice ??
                        (!boardView.searchQuery &&
                        !hasActiveFilters(boardView.filters) &&
                        !boardView.showClosed
                          ? 'Select tickets on the Tickets tab and click "Move to My Board".'
                          : undefined)
                      }
                    />
                  }
                />
              </div>

              {boardView.totalPages > 1 && (
                <div className="flex shrink-0 items-center justify-between gap-2 border-t border-neutral-200 px-4 py-2 dark:border-neutral-700">
                  <Text size="xs" variant="muted">
                    {boardView.selectedKeys.size > 0
                      ? `${boardView.selectedKeys.size} selected`
                      : `${boardView.sortedTickets.length} ticket${boardView.sortedTickets.length === 1 ? '' : 's'}`}
                  </Text>
                  <Pagination
                    page={boardView.page}
                    totalPages={boardView.totalPages}
                    onPageChange={boardView.setPage}
                    size="sm"
                    label="Ticket pages"
                  />
                </div>
              )}
            </Card>
          </TabsContent>
        </Tabs>

        {/* Edit ticket modal (creator only) */}
        <Modal open={!!editTicket} onOpenChange={(open) => !open && setEditTicket(null)}>
          <ModalHeader>
            <ModalTitle>Edit Ticket</ModalTitle>
            <ModalClose />
          </ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              <Input
                label={titleFetching ? 'Title (fetching…)' : 'Title'}
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className={noFocusRingClass}
                autoFocus
                disabled={titleFetching}
                onPaste={(e) => {
                  const text = (e.clipboardData ?? (e.nativeEvent as ClipboardEvent).clipboardData)
                    ?.getData('text')
                    ?.trim();
                  if (!text || !isGithubIssueUrl(text)) return;
                  e.preventDefault();
                  setEditGithub(text);
                  setTitleFetching(true);
                  void fetchIssueTitle(text).then((title) => {
                    if (title) setEditTitle(title);
                    setTitleFetching(false);
                  });
                }}
              />
              <Textarea
                label="Description"
                placeholder="Add a description…"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                className={noFocusRingClass}
                autoResize
                rows={3}
              />
              <Input
                label="GitHub URL"
                type="url"
                placeholder="https://github.com/…"
                value={editGithub}
                className={noFocusRingClass}
                onChange={(e) => {
                  const url = e.target.value;
                  setEditGithub(url);
                  if (editFetchTimer.current) clearTimeout(editFetchTimer.current);
                  if (isGithubIssueUrl(url)) {
                    editFetchTimer.current = setTimeout(() => {
                      setTitleFetching(true);
                      void fetchIssueTitle(url).then((title) => {
                        if (title) setEditTitle(title);
                        setTitleFetching(false);
                      });
                    }, 300);
                  }
                }}
              />
              <div>
                <label className="mb-2 block text-sm font-medium">Assignees</label>
                <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-neutral-200 p-3 dark:border-neutral-700">
                  {memberOptions.map((option) => (
                    <label
                      key={option.value}
                      className="flex items-center gap-2 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800 p-1 rounded"
                    >
                      <input
                        type="checkbox"
                        checked={editAssignees.includes(option.value)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setEditAssignees([...editAssignees, option.value]);
                          } else {
                            setEditAssignees(editAssignees.filter((id) => id !== option.value));
                          }
                        }}
                        className="h-4 w-4 rounded border-neutral-300 text-primary focus:ring-primary"
                      />
                      <span className="text-sm">{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <Select
                label="Priority"
                options={PRIORITY_OPTIONS}
                value={editPriority || 'none'}
                onValueChange={setEditPriority}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="outline" onClick={() => setEditTicket(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSaveEdit}
              isLoading={editSaving}
              loadingText="Saving…"
              disabled={!editTitle.trim()}
            >
              Save
            </Button>
          </ModalFooter>
        </Modal>

        {/* Change Status modal */}
        <Modal
          open={!!changeStatusTicket}
          onOpenChange={(open) => !open && setChangeStatusTicket(null)}
          size="sm"
        >
          <ModalHeader>
            <ModalTitle>Change Status</ModalTitle>
            <ModalClose />
          </ModalHeader>
          <ModalBody>
            <Select
              label="Status"
              options={STATUS_OPTIONS}
              value={changeStatusValue}
              onValueChange={setChangeStatusValue}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="outline" onClick={() => setChangeStatusTicket(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSaveStatus}
              isLoading={changeStatusSaving}
              loadingText="Saving…"
            >
              Save
            </Button>
          </ModalFooter>
        </Modal>

        {/* Ticket Details modal */}
        {detailsTicket && (
          <Modal open onOpenChange={(open) => !open && setDetailsTicket(null)}>
            <ModalHeader>
              <ModalTitle>Ticket Details</ModalTitle>
              <ModalClose />
            </ModalHeader>
            <ModalBody>
              <div className="space-y-3">
                <div>
                  <Text size="xs" variant="muted" weight="medium">
                    Title
                  </Text>
                  <Text size="sm">{detailsTicket.title}</Text>
                </div>
                {detailsTicket.description && (
                  <div>
                    <Text size="xs" variant="muted" weight="medium">
                      Description
                    </Text>
                    <Text size="sm">{detailsTicket.description}</Text>
                  </div>
                )}
                <div className="flex gap-6">
                  <div>
                    <Text size="xs" variant="muted" weight="medium">
                      Status
                    </Text>
                    <Text size="sm">
                      {STATUS_OPTIONS.find((s) => s.value === detailsTicket.status)?.label ??
                        detailsTicket.status ??
                        'Open'}
                    </Text>
                  </div>
                  {detailsTicket.priority && (
                    <div>
                      <Text size="xs" variant="muted" weight="medium">
                        Priority
                      </Text>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span
                          className={`inline-flex items-center rounded-full border px-1.5 py-px text-[11px] font-medium ${priorityLabelClass(detailsTicket.priority)}`}
                        />
                        <Text size="sm">
                          {detailsTicket.priority.charAt(0).toUpperCase() +
                            detailsTicket.priority.slice(1)}
                        </Text>
                      </div>
                    </div>
                  )}
                </div>
                {detailsTicket.github && (
                  <div>
                    <Text size="xs" variant="muted" weight="medium">
                      GitHub
                    </Text>
                    <a
                      href={detailsTicket.github}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-500 hover:underline"
                    >
                      {detailsTicket.github}
                    </a>
                  </div>
                )}
                <div className="flex gap-6">
                  <div>
                    <Text size="xs" variant="muted" weight="medium">
                      Created By
                    </Text>
                    <Text size="sm">
                      {getAssigneeName(detailsTicket.createdBy) ?? detailsTicket.createdBy}
                    </Text>
                  </div>
                  <div>
                    <Text size="xs" variant="muted" weight="medium">
                      Created At
                    </Text>
                    <Text size="sm">
                      {new Date(detailsTicket.createdAt).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </Text>
                  </div>
                </div>
                {detailsTicket.assignedTo && detailsTicket.assignedTo.length > 0 && (
                  <div>
                    <Text size="xs" variant="muted" weight="medium">
                      Assigned To
                    </Text>
                    <div className="flex flex-wrap gap-2">
                      {detailsTicket.assignedTo.map((id) => {
                        const name = getAssigneeName(id);
                        return (
                          <div key={id} className="flex items-center gap-2">
                            <UserAvatar name={name ?? id} size="xs" />
                            <Text size="sm">{name ?? id}</Text>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="space-y-1 pt-1">
                  <AttachmentsPanel
                    key={detailsAttachmentRefresh}
                    kind="ticket"
                    entityId={detailsTicket.id}
                    currentUserId={userId ?? undefined}
                  />
                  <PulseUploadButton
                    ticketId={detailsTicket.id}
                    onUploadComplete={() => setDetailsAttachmentRefresh((n) => n + 1)}
                  />
                </div>
              </div>
            </ModalBody>
            <ModalFooter>
              {userId && !detailsTicket.assignedTo?.includes(userId) && (
                <Button
                  variant="secondary"
                  onClick={async () => {
                    const updatedAssignees = [...(detailsTicket.assignedTo ?? []), userId];
                    await ticketApi.assignTicket(detailsTicket.id, updatedAssignees);
                    setDetailsTicket((t) => (t ? { ...t, assignedTo: updatedAssignees } : t));
                    void refetch();
                  }}
                >
                  Assign to me
                </Button>
              )}
              <Button variant="outline" onClick={() => setDetailsTicket(null)}>
                Close
              </Button>
            </ModalFooter>
          </Modal>
        )}

        {/* Delete confirmation — covers both single-row (⋮ menu) and bulk delete */}
        <Modal
          open={deleteIds.length > 0}
          onOpenChange={(open) => !open && setDeleteIds([])}
          size="sm"
        >
          <ModalHeader>
            <ModalTitle>
              {deleteIds.length > 1 ? `Delete ${deleteIds.length} Tickets?` : 'Delete Ticket?'}
            </ModalTitle>
            <ModalClose />
          </ModalHeader>
          <ModalBody>
            <Text variant="muted" size="sm">
              {deleteIds.length > 1
                ? 'This will permanently delete these tickets and remove them from all clock events.'
                : 'This will permanently delete this ticket and remove it from all clock events.'}
            </Text>
          </ModalBody>
          <ModalFooter>
            <Button variant="outline" onClick={() => setDeleteIds([])}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete} isLoading={deleteLoading}>
              Delete
            </Button>
          </ModalFooter>
        </Modal>

        {/* Clock-In Prompt Modal */}
        <Modal
          open={showClockInPrompt}
          onOpenChange={(open) => {
            setShowClockInPrompt(open);
            if (!open) {
              setPendingStartTicket(null);
              setClockInPromptError(null);
            }
          }}
          size="sm"
          aria-labelledby="clock-in-prompt-title"
        >
          <ModalHeader>
            <ModalTitle id="clock-in-prompt-title">Clock In Required</ModalTitle>
            <ModalClose />
          </ModalHeader>
          <ModalBody>
            <div className="space-y-2">
              <Text size="sm">
                You must be clocked in before starting a timer. Do you want to clock in now?
              </Text>
              {clockInPromptError && (
                <Text size="xs" className="text-danger">
                  {clockInPromptError}
                </Text>
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowClockInPrompt(false);
                setPendingStartTicket(null);
                setClockInPromptError(null);
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" onClick={handleClockInAndStart}>
              Clock In Now
            </Button>
          </ModalFooter>
        </Modal>

        <Modal open={showNoTeamDialog} onOpenChange={setShowNoTeamDialog} size="sm">
          <ModalHeader>
            <ModalTitle>No team available</ModalTitle>
            <ModalClose />
          </ModalHeader>
          <ModalBody className="space-y-3">
            <Text size="sm" className="text-neutral-600 dark:text-neutral-300">
              This organization does not have a team yet. A team must exist before tickets can be
              created.
            </Text>
            <Text size="sm" className="text-neutral-600 dark:text-neutral-300">
              Create or join a team in this organization, then come back to add tickets.
            </Text>
          </ModalBody>
          <ModalFooter>
            <Button variant="outline" onClick={() => setShowNoTeamDialog(false)}>
              Close
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setShowNoTeamDialog(false);
                navigate('/app/teams');
              }}
            >
              Go to Teams
            </Button>
          </ModalFooter>
        </Modal>
      </div>
    </AppPage>
  );
};
