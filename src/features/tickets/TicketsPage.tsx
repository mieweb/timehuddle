/**
 * TicketsPage — the unified ticket table at /app/tickets.
 *
 * Shows tickets from every registered source (TimeHuddle's own tickets, a
 * connected Redmine instance) in one table. Source is a column and a filter,
 * not a mode: there is no view switcher. See `sources/README.md`.
 *
 * This page owns TimeHuddle-specific mutations (create, edit, delete, status,
 * assignment); rows gate those controls on each source's capabilities.
 */
import { faPlus, faSearch } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Button,
  Alert,
  AlertDescription,
  Dropdown,
  DropdownItem,
  Input,
  Modal,
  ModalBody,
  ModalClose,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Select,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
  Textarea,
  useToast,
} from '@mieweb/ui';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import {
  ApiError,
  myBoardApi,
  redmineApi,
  teamApi,
  ticketApi,
  type RedmineIssue,
  type Team,
  type TeamMember,
  type Ticket,
} from '../../lib/api';
import { useTeam } from '../../lib/TeamContext';
import { getDdpClient, ddpDocToTicket } from '../../lib/ddp';
import { useSession } from '../../lib/useSession';
import { useRunningTicket } from '../../lib/useRunningTicket';
import { useRefresh } from '../../lib/RefreshContext';
import { REDMINE_CHANGED, useRedmineStatus } from '../../lib/useRedmineStatus';
import { useRouter } from '../../ui/router';
import { AppPage } from '../../ui/AppPage';
import { fetchGithubIssueTitle, isGithubIssueUrl } from './githubIssue';
import { PRIORITY_OPTIONS } from './huddleTicketOptions';
import { TicketCreateModal } from './TicketCreateModal';
import { TicketTablePanel } from './TicketTablePanel';
import { RedmineIssueCreateModal } from './redmine/RedmineIssueCreateModal';
import { RedmineIssueEditModal } from './redmine/RedmineIssueEditModal';
import { RedmineSuggestions } from './redmine/RedmineSuggestions';
import {
  huddleSource,
  invalidateRedmineCache,
  redmineSource,
  ticketRefOf,
  useUnavailableRedmineBoardIds,
  useUnifiedTickets,
  type UnifiedTicket,
} from './sources';
import { removalText } from './ticketRemovalStrings';
import type { TicketTimerOutcome } from './startTicketTimer';
import { useMeAssigneeKeys } from './useMeAssigneeKeys';
import { useTicketStart } from '../timers/TicketStartProvider';
import { timerLabel } from '../timers/ticketTimerStrings';
import { useTicketTableView } from './useTicketTableView';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'in-progress', label: 'In Progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'closed', label: 'Completed' },
  { value: 'reviewed', label: 'Reviewed' },
];

/** The most Redmine ids `redmine.issues.removeFromTable` takes per call. */
const REDMINE_REMOVE_CHUNK = 100;

/** `items` in slices of at most `size`. */
function chunk<T>(items: T[], size: number): T[][] {
  const slices: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    slices.push(items.slice(start, start + size));
  }
  return slices;
}

export const TicketsPage: React.FC = () => {
  const { user } = useSession();
  const userId = user?.id ?? null;
  const { teams, selectedTeam, selectedTeamId, teamsReady } = useTeam();
  const { navigate, pathname } = useRouter();
  const toast = useToast();

  // Map from teamId → members for cross-team member lookups
  const [membersByTeam, setMembersByTeam] = useState<Map<string, TeamMember[]>>(new Map());

  // Timer state — which ticket has the open timer (shared overnight-safe hook).
  // Keyed by `${sourceId}:${id}`, not id: a Redmine issue #42 and a Huddle
  // ticket are different rows that can share neither state nor identity.
  const runningTicket = useRunningTicket(true);
  // Starts and stops (with the clock-in prompt and the toasts) live app-wide.
  const { start: startTimer, stop: stopTimer, busyKey: timerLoadingKey } = useTicketStart();

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
      membersKey: allMembers.map((m) => `${m.id}:${m.name || m.email}`).join('|'),
    }),
    [userId, teams, getAssigneeName, allMembers],
  );

  const {
    tickets: allTickets,
    loading: ticketsLoading,
    errors: sourceErrors,
    refetch,
    setSourceItems,
  } = useUnifiedTickets(sourceCtx);

  // The Redmine list is cached per session, so a refetch after a Redmine write
  // must drop that cache or it would re-serve the pre-write rows.
  const refetchAfterRedmineWrite = useCallback(() => {
    invalidateRedmineCache();
    void refetch();
  }, [refetch]);

  // Pull-to-refresh handler — only while this page is the active route. It
  // stays mounted (hidden) behind other routes, so registering unconditionally
  // would hijack the visible page's refresh handler.
  //
  // Registers the cache-dropping variant: Redmine is the source most likely to
  // have changed behind the user's back.
  useRefresh(refetchAfterRedmineWrite, pathname === '/app/tickets');

  // Redmine issues are edited and created in their own dialogs, under the
  // user's personal Redmine key.
  const [redmineEditIssueId, setRedmineEditIssueId] = useState<number | null>(null);
  const [showRedmineCreate, setShowRedmineCreate] = useState(false);
  const [redmineNotice, setRedmineNotice] = useState<{
    issueId: number;
    message: string;
    isWarning: boolean;
  } | null>(null);

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

  // Linking or unlinking a Redmine account in Settings. This page stays mounted
  // behind that route, so the event is the only thing that tells it to look
  // again — and the cached issue list has to go with it (#562). Bound to the
  // event rather than to the status value: an effect on the value would also
  // fire on first load, costing a wasted fetch and a row flicker at boot.
  useEffect(() => {
    const onRedmineChanged = () => refetchAfterRedmineWrite();
    window.addEventListener(REDMINE_CHANGED, onRedmineChanged);
    return () => window.removeEventListener(REDMINE_CHANGED, onRedmineChanged);
  }, [refetchAfterRedmineWrite]);

  // Mutation loading states
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  // Create state
  const [showCreate, setShowCreate] = useState(false);
  const [showNoTeamDialog, setShowNoTeamDialog] = useState(false);
  // Controlled so picking an item closes the menu before its dialog opens.
  const [newTicketMenuOpen, setNewTicketMenuOpen] = useState(false);

  // Tickets tab vs My Board tab — same URL, local state only.
  const [activeView, setActiveView] = useState<'tickets' | 'my-board'>('tickets');

  // My Board membership — identity only (`${sourceId}:${id}` keys, matching
  // UnifiedTicket.key). Display fields are resolved by filtering allTickets,
  // never snapshotted server-side (Core Model Data Discipline).
  const [boardKeys, setBoardKeys] = useState<Set<string>>(new Set());
  // Huddle board entries the server says the user can no longer see.
  const [unavailableHuddleKeys, setUnavailableHuddleKeys] = useState<Set<string>>(new Set());
  // Reloaded on tickets:refetch too: a timer start (from anywhere, including
  // one that waited for a clock-in) can add a ticket to the board.
  // A failed reload keeps the board as it was rather than emptying it.
  const loadBoard = useCallback(
    () =>
      void myBoardApi
        .list()
        .then((entries) => {
          const keyOf = (e: { sourceId: string; ticketId: string }) =>
            `${e.sourceId}:${e.ticketId}`;
          setBoardKeys(new Set(entries.map(keyOf)));
          setUnavailableHuddleKeys(new Set(entries.filter((e) => e.unavailable).map(keyOf)));
        })
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    loadBoard();
    window.addEventListener('tickets:refetch', loadBoard);
    return () => window.removeEventListener('tickets:refetch', loadBoard);
  }, [loadBoard]);
  const boardTickets = useMemo(
    () => allTickets.filter((t) => boardKeys.has(t.key)),
    [allTickets, boardKeys],
  );

  // Whether the user has linked a Redmine account, so the board can say *why*
  // its Redmine rows are missing instead of silently showing a short list.
  // `null` is "not known yet", which shows nothing — only `false` is a
  // confident "not connected".
  const redmineStatus = useRedmineStatus();
  const redmineConnected = redmineStatus === null ? null : redmineStatus.connected;
  const redmineBaseUrl = redmineStatus?.connected ? (redmineStatus.baseUrl ?? null) : null;

  // Superset lookup for resolving a selection key (Tickets or My Board tab)
  // back to its ticket, e.g. to gate the bulk Delete button.
  const ticketByKey = useMemo(() => new Map(allTickets.map((t) => [t.key, t])), [allTickets]);

  /**
   * Board entries with no ticket behind them. A board row is identity-only, so
   * it outlives the ticket it points at: a Redmine issue is unreachable while
   * the account is unlinked, or deleted, and a Huddle ticket may have been
   * deleted. Only entries the server confirmed gone are offered for removal —
   * never one that merely failed to load.
   */
  const unavailableRedmineIds = useUnavailableRedmineBoardIds(userId);
  const [removeUnavailableFailed, setRemoveUnavailableFailed] = useState(false);
  const unresolvedBoard = useMemo(() => {
    const missing = [...boardKeys].filter((key) => !ticketByKey.has(key));
    if (ticketsLoading || missing.length === 0) return null;
    const redmineCount = missing.filter((key) => key.startsWith('redmine:')).length;
    if (redmineCount > 0 && redmineConnected === false) {
      return { message: removalText.connectRedmine(redmineCount), removableKeys: [] };
    }
    const goneRedmine = new Set(unavailableRedmineIds.map((id) => `redmine:${id}`));
    const removableKeys = missing.filter(
      (key) => goneRedmine.has(key) || unavailableHuddleKeys.has(key),
    );
    return {
      message:
        removableKeys.length > 0
          ? removalText.boardUnavailable(removableKeys.length)
          : removalText.boardNotLoaded(missing.length),
      removableKeys,
    };
  }, [
    boardKeys,
    ticketByKey,
    ticketsLoading,
    redmineConnected,
    unavailableRedmineIds,
    unavailableHuddleKeys,
  ]);
  const unresolvedBoardNotice = unresolvedBoard?.message ?? null;

  // Search/filter/sort/paginate/select — one independent pipeline per tab.
  // Resolves the assignee filter's "Me" option across both id namespaces.
  const meKeys = useMeAssigneeKeys(redmineStatus);
  const ticketsView = useTicketTableView(allTickets, meKeys);
  const boardView = useTicketTableView(boardTickets, meKeys);

  // Delete state — a list so the same confirm modal covers single-row (⋮ menu)
  // and bulk (action bar) delete without two code paths.
  // Huddle tickets are deleted outright; Redmine issues only leave TimeHuddle.
  const [deleteRequest, setDeleteRequest] = useState<{
    huddleIds: string[];
    redmineIds: number[];
  } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  // Member options for assignee select in the edit modal
  const memberOptions = useMemo(() => {
    const teamId = selectedTeamId ?? teams[0]?.id;
    const members = teamId ? (membersByTeam.get(teamId) ?? []) : [];
    return members.map((m) => ({ value: m.id, label: m.name || m.email }));
  }, [membersByTeam, selectedTeamId, teams]);

  // ── Handlers ──

  // ── Ticket timers (started from My Board and Redmine suggestions) ──

  const handleToggleTimer = useCallback(
    (ticket: UnifiedTicket): Promise<TicketTimerOutcome> => {
      const label = timerLabel(ticket.sourceId, ticket.id, ticket.title);
      if (runningTicket?.key === ticket.key && runningTicket.sessionId) {
        return stopTimer({ sessionId: runningTicket.sessionId, ticketKey: ticket.key, label });
      }
      // Clocked out, this opens the clock-in prompt; a Redmine suggestion that
      // is not a table row yet is pinned into the table (`startTicketTimer`).
      return startTimer({
        kind: 'ticket',
        ticket,
        label,
        inTable: ticketByKey.has(ticket.key),
        onBoard: boardKeys.has(ticket.key),
      });
    },
    [runningTicket, startTimer, stopTimer, ticketByKey, boardKeys],
  );

  // A suggestion is a Redmine issue, not yet a table row: shape it the way the
  // table would, so it goes through the same start/stop and clock-in path.
  const handleSuggestionTimer = useCallback(
    (issue: RedmineIssue) =>
      handleToggleTimer(redmineSource.toUnified({ issue, baseUrl: redmineBaseUrl }, sourceCtx)),
    [handleToggleTimer, redmineBaseUrl, sourceCtx],
  );

  // Redmine issues already in the table, so "More from Redmine" offers only new ones.
  const tableRedmineIssueIds = useMemo(
    () => new Set(allTickets.filter((t) => t.sourceId === 'redmine').map((t) => Number(t.id))),
    [allTickets],
  );
  const runningRedmineIssueId =
    runningTicket?.source === 'redmine' ? Number(runningTicket.id) : null;

  const startHuddleCreate = useCallback(() => {
    setNewTicketMenuOpen(false);
    if (!selectedTeam) {
      setShowNoTeamDialog(true);
      return;
    }
    setShowCreate(true);
  }, [selectedTeam]);

  const handleRedmineCreated = useCallback(
    (issueId: number, warning: string | null) => {
      setRedmineNotice({
        issueId,
        message: warning ?? `Created Redmine issue #${issueId}.`,
        isWarning: Boolean(warning),
      });
      refetchAfterRedmineWrite();
    },
    [refetchAfterRedmineWrite],
  );

  // The list only carries the normalized shape, so fetch the full ticket the
  // edit form needs (description, assignees) when the modal actually opens.
  const openEditModal = useCallback(async (unified: UnifiedTicket) => {
    if (!unified.capabilities.edit) return;
    if (unified.sourceId === 'redmine') {
      setRedmineEditIssueId(Number(unified.id));
      return;
    }
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

  // A Redmine status change goes through the edit dialog: its choices are the
  // transitions Redmine's workflow allows, not Huddle's fixed status list.
  const handleChangeStatusRequest = useCallback((t: UnifiedTicket) => {
    if (t.sourceId === 'redmine') {
      setRedmineEditIssueId(Number(t.id));
      return;
    }
    setChangeStatusTicket(t);
    setChangeStatusValue(t.status.native || 'open');
  }, []);

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

  const requestDelete = useCallback((tickets: UnifiedTicket[]) => {
    setDeleteError(null);
    setDeleteRequest({
      huddleIds: tickets.filter((t) => t.sourceId === 'huddle').map((t) => t.id),
      redmineIds: tickets.filter((t) => t.sourceId === 'redmine').map((t) => Number(t.id)),
    });
  }, []);

  const closeDeleteDialog = useCallback(() => setDeleteRequest(null), []);

  const handleDelete = useCallback(async () => {
    if (!deleteRequest) return;
    const { huddleIds, redmineIds } = deleteRequest;
    setDeleteLoading(true);
    setDeleteError(null);
    // A deleted Huddle ticket leaves its board entries behind; the server drops
    // the Redmine ones along with the removal.
    const huddleBoardRefs = huddleIds
      .filter((id) => boardKeys.has(`huddle:${id}`))
      .map((id) => ({ sourceId: 'huddle', ticketId: id }));
    let failed: boolean;
    try {
      const results = await Promise.allSettled([
        ...huddleIds.map((id) => ticketApi.deleteTicket(id)),
        ...chunk(redmineIds, REDMINE_REMOVE_CHUNK).map((ids) =>
          redmineApi.issues.removeFromTable(ids),
        ),
        ...(huddleBoardRefs.length ? [myBoardApi.removeMany(huddleBoardRefs)] : []),
      ]);
      failed = results.some((r) => r.status === 'rejected');
    } finally {
      setDeleteLoading(false);
    }
    if (redmineIds.length) invalidateRedmineCache();
    void refetch();
    loadBoard();
    ticketsView.clearSelection();
    boardView.clearSelection();
    if (failed) {
      setDeleteError(removalText.deleteFailed);
      return;
    }
    setDeleteRequest(null);
  }, [deleteRequest, boardKeys, refetch, loadBoard, ticketsView, boardView]);

  /** Drop the board entries the server confirmed point at nothing. */
  const handleRemoveUnavailable = useCallback(() => {
    const refs = (unresolvedBoard?.removableKeys ?? []).map(ticketRefOf);
    if (!refs.length) return;
    setRemoveUnavailableFailed(false);
    void myBoardApi
      .removeMany(refs)
      .then(loadBoard)
      .catch(() => setRemoveUnavailableFailed(true));
  }, [unresolvedBoard, loadBoard]);

  // Ticket is eligible for the caller to delete — the same gate the row's ⋮
  // menu already applies (`capabilities.delete && isCreator`).
  const canDelete = useCallback(
    (ticket: UnifiedTicket) => ticket.capabilities.delete && ticket.createdBy?.id === userId,
    [userId],
  );

  // The bulk Delete button is disabled unless every currently selected
  // ticket (on whichever tab) is eligible. A Redmine issue always is: deleting
  // it only takes it out of TimeHuddle.
  const canDeleteSelection = useCallback(
    (selectedKeys: Set<string>) =>
      selectedKeys.size > 0 &&
      [...selectedKeys].every((key) => {
        const ticket = ticketByKey.get(key);
        if (!ticket) return false;
        return ticket.sourceId === 'redmine' || canDelete(ticket);
      }),
    [ticketByKey, canDelete],
  );

  const handleBulkDeleteRequest = useCallback(
    (selectedKeys: Set<string>) => {
      requestDelete(
        [...selectedKeys].map((key) => ticketByKey.get(key)).filter((t): t is UnifiedTicket => !!t),
      );
    },
    [ticketByKey, requestDelete],
  );

  const handleMoveToBoard = useCallback(() => {
    const keys = [...ticketsView.selectedKeys];
    const refs = keys.map(ticketRefOf);
    void myBoardApi
      .addMany(refs)
      .then(() => {
        setBoardKeys((prev) => new Set([...prev, ...keys]));
        ticketsView.clearSelection();
      })
      // A full board is refused with the server's own explanation.
      .catch((err) =>
        toast.error(
          err instanceof ApiError && err.code === 'board-full'
            ? err.message
            : removalText.boardAddFailed,
        ),
      );
  }, [ticketsView, toast]);

  const handleRemoveFromBoard = useCallback(() => {
    const keys = [...boardView.selectedKeys];
    const refs = keys.map(ticketRefOf);
    void myBoardApi.removeMany(refs).then(
      () => {
        setBoardKeys((prev) => {
          const next = new Set(prev);
          for (const key of keys) next.delete(key);
          return next;
        });
        boardView.clearSelection();
        // A Redmine issue on the board is a table row for that reason alone
        // (`board`), so the table may lose it too.
        if (refs.some((ref) => ref.sourceId === 'redmine')) {
          invalidateRedmineCache();
          void refetch();
        }
      },
      () => toast.error(removalText.boardRemoveFailed),
    );
  }, [boardView, refetch, toast]);

  const noFocusRingClass =
    'ring-0 focus:ring-0 focus-visible:ring-0 focus:outline-none focus-visible:outline-none focus:border-blue-300 focus-visible:border-blue-300';

  const newTicketButton = (
    <Button
      variant="primary"
      size="sm"
      leftIcon={<FontAwesomeIcon icon={faPlus} />}
      // Teams arrive asynchronously, so selectedTeam is null on first
      // paint even for users who have one. Without this guard an early
      // click reports "No team available" to a user who has a team.
      disabled={!teamsReady}
      onClick={startHuddleCreate}
      className="shrink-0 rounded-lg"
    >
      New Ticket
    </Button>
  );

  // What both tabs' tables share; each tab adds its own view and labels.
  const sharedTableProps = {
    errors: sourceErrors,
    isCreator: (t: UnifiedTicket) => t.createdBy?.id === userId,
    runningTicketKey: runningTicket?.key ?? null,
    timerLoadingKey,
    onToggleTimer: handleToggleTimer,
    onEditRequest: (t: UnifiedTicket) => void openEditModal(t),
    onDeleteRequest: (t: UnifiedTicket) => requestDelete([t]),
    onChangeStatusRequest: handleChangeStatusRequest,
  };

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
            <TicketTablePanel
              {...sharedTableProps}
              view={ticketsView}
              loading={ticketsLoading}
              search={
                <>
                  {redmineConnected ? (
                    // With Redmine linked, "New Ticket" asks which system the new
                    // item belongs to. Dropdown replaces the trigger's onClick.
                    <Dropdown
                      trigger={newTicketButton}
                      placement="bottom-start"
                      open={newTicketMenuOpen}
                      onOpenChange={setNewTicketMenuOpen}
                    >
                      <DropdownItem onClick={startHuddleCreate}>TimeHuddle ticket</DropdownItem>
                      <DropdownItem
                        onClick={() => {
                          setNewTicketMenuOpen(false);
                          setRedmineNotice(null);
                          setShowRedmineCreate(true);
                        }}
                      >
                        Redmine issue
                      </DropdownItem>
                    </Dropdown>
                  ) : (
                    newTicketButton
                  )}

                  <RedmineSuggestions
                    userId={userId}
                    query={ticketsView.searchQuery}
                    onQueryChange={ticketsView.setSearchQuery}
                    baseUrl={redmineBaseUrl}
                    tableIssueIds={tableRedmineIssueIds}
                    runningIssueId={runningRedmineIssueId}
                    onToggleTimer={handleSuggestionTimer}
                    inputClassName={`ps-8 rounded-lg ${noFocusRingClass}`}
                  />
                </>
              }
              beforeBulkBar={
                <div className="redmine-create-notice" aria-live="polite">
                  {redmineNotice && (
                    <Alert
                      variant={redmineNotice.isWarning ? 'warning' : 'success'}
                      dismissible
                      onDismiss={() => setRedmineNotice(null)}
                    >
                      <AlertDescription>
                        {redmineNotice.message}{' '}
                        {redmineBaseUrl && (
                          <a
                            href={`${redmineBaseUrl}/issues/${redmineNotice.issueId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium underline"
                          >
                            Open in Redmine
                          </a>
                        )}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              }
              canDeleteSelected={canDeleteSelection(ticketsView.selectedKeys)}
              onBulkDelete={() => handleBulkDeleteRequest(ticketsView.selectedKeys)}
              primaryLabel="Move to My Board"
              onPrimaryAction={handleMoveToBoard}
              emptyText={{
                open: 'No open tickets',
                closed: 'No closed tickets',
                hint: 'Create one to get started.',
              }}
            />
          </TabsContent>

          {/* ── My Board tab ── */}
          <TabsContent
            value="my-board"
            forceMount
            className="mt-0 flex min-h-0 flex-1 flex-col gap-3"
          >
            <TicketTablePanel
              {...sharedTableProps}
              showTimerColumn
              view={boardView}
              loading={ticketsLoading}
              search={
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
              }
              // Unresolvable board entries, announced politely.
              afterBulkBar={
                <div
                  role="status"
                  aria-live="polite"
                  className="board-unresolved-notice flex flex-wrap items-center gap-2 empty:hidden"
                >
                  {unresolvedBoard && (
                    <>
                      <Text size="xs" variant="muted">
                        {unresolvedBoard.message}
                      </Text>
                      {removeUnavailableFailed && (
                        <Text size="xs" variant="destructive">
                          {removalText.removeUnavailableFailed}
                        </Text>
                      )}
                      {unresolvedBoard.removableKeys.length > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleRemoveUnavailable}
                          aria-label={removalText.removeUnavailableLabel(
                            unresolvedBoard.removableKeys.length,
                          )}
                        >
                          {removalText.removeUnavailable}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              }
              canDeleteSelected={canDeleteSelection(boardView.selectedKeys)}
              onBulkDelete={() => handleBulkDeleteRequest(boardView.selectedKeys)}
              primaryLabel="Remove from My Board"
              onPrimaryAction={handleRemoveFromBoard}
              emptyText={{
                open: 'Your board is empty',
                closed: 'No closed tickets on your board',
                hint: 'Select tickets on the Tickets tab and click "Move to My Board".',
              }}
              emptyNotice={unresolvedBoardNotice}
            />
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
                  void fetchGithubIssueTitle(text).then((title) => {
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
                      void fetchGithubIssueTitle(url).then((title) => {
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

        {/* Delete confirmation — covers both single-row (⋮ menu) and bulk delete */}
        <Modal
          open={deleteRequest !== null}
          onOpenChange={(open) => !open && closeDeleteDialog()}
          size="sm"
        >
          <ModalHeader>
            <ModalTitle>
              {removalText.deleteTitle(
                (deleteRequest?.huddleIds.length ?? 0) + (deleteRequest?.redmineIds.length ?? 0),
              )}
            </ModalTitle>
            <ModalClose />
          </ModalHeader>
          <ModalBody className="space-y-2">
            {!!deleteRequest?.redmineIds.length && (
              <Text variant="muted" size="sm">
                {removalText.redmineRemoved(deleteRequest.redmineIds.length)}
              </Text>
            )}
            {!!deleteRequest?.huddleIds.length && (
              <Text variant="muted" size="sm">
                {removalText.huddleDeleted(deleteRequest.huddleIds.length)}
              </Text>
            )}
            {deleteError && (
              <Alert variant="danger" role="alert">
                <AlertDescription>{deleteError}</AlertDescription>
              </Alert>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="outline" onClick={closeDeleteDialog}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete} isLoading={deleteLoading}>
              Delete
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

        <TicketCreateModal
          open={showCreate}
          onClose={() => setShowCreate(false)}
          onCreated={() => void refetch()}
          teams={teams}
          defaultTeamId={selectedTeam?.id ?? null}
          userId={userId}
        />
        <RedmineIssueEditModal
          issueId={redmineEditIssueId}
          onClose={() => setRedmineEditIssueId(null)}
          onSaved={refetchAfterRedmineWrite}
        />
        <RedmineIssueCreateModal
          open={showRedmineCreate}
          onClose={() => setShowRedmineCreate(false)}
          onCreated={handleRedmineCreated}
        />
      </div>
    </AppPage>
  );
};
