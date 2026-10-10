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
import {
  Button,
  ButtonGroup,
  Alert,
  AlertDescription,
  Input,
  Modal,
  ModalBody,
  ModalClose,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Select,
  Text,
  Textarea,
  useMediaQuery,
  useToast,
} from '@mieweb/ui';
import { Binoculars, CheckCheck, Plus, X } from 'lucide-react';
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
import { SegmentedSwitcher, type SegmentedOption } from '../../ui/SegmentedSwitcher';
import { UserRoundArrowLeft } from '../../ui/UserRoundArrowLeft';
import {
  ASSIGNED_FILTERS,
  STARTER_LIMIT,
  assignedToMe,
  isApproximate,
  starterText,
  useAssignedNotice,
} from './assignedStarter';
import { PRIORITY_OPTIONS } from './huddleTicketOptions';
import { TicketCreateModal } from './TicketCreateModal';
import { COMPACT_QUERY } from './TicketTable';
import { TicketTablePanel, TicketViewControls } from './TicketTablePanel';
import { ticketLinkText } from './link/ticketLinkStrings';
import { RedmineIssueEditModal } from './redmine/RedmineIssueEditModal';
import { RedmineSuggestions } from './redmine/RedmineSuggestions';
import {
  boardEntryKeys,
  huddleSource,
  invalidateRedmineCache,
  isOnBoard,
  linkedIssueKey,
  redmineSource,
  ticketKey,
  ticketRefOf,
  useUnavailableRedmineBoardIds,
  useUnifiedTickets,
  type UnifiedTicket,
} from './sources';
import { removalText } from './ticketRemovalStrings';
import type { TicketTimerOutcome } from './startTicketTimer';
import { useBoardActions } from './useBoardActions';
import { useMeAssigneeKeys } from './useMeAssigneeKeys';
import { useMyBoardKeys } from './useMyBoardKeys';
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

/** The two views' names and the empty board's pointer to the other one. */
const viewText = {
  myBoard: 'My Board',
  allSources: 'All Sources',
  emptyBoardHint: 'Find tickets in All Sources and move them here.',
  browseAllSources: 'Browse All Sources',
  switcherLabel: 'Tickets view',
  newTicket: 'New Ticket',
  newTicketPrefix: 'New ',
  ticket: 'Ticket',
  select: 'Select',
  doneSelecting: 'Done',
};

type TicketsView = 'tickets' | 'my-board';

/** My Board first: it is the view the page opens on. All Sources is the lookup. */
const VIEW_OPTIONS: readonly SegmentedOption<TicketsView>[] = [
  { value: 'my-board', label: viewText.myBoard },
  {
    value: 'tickets',
    label: viewText.allSources,
    icon: <Binoculars className="h-4 w-4" aria-hidden="true" />,
    iconOnly: true,
  },
];

/**
 * Both views stay mounted once shown, so each keeps its filters, sort, page and selection
 * while the other is showing; the one not showing is only hidden.
 */
const viewPanelClass = (showing: boolean) =>
  `tickets-view-panel min-h-0 flex-1 flex-col gap-3 ${showing ? 'flex' : 'hidden'}`;

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

  // Stable key derived from sorted team IDs — effects below only rerun when the
  // actual set of teams changes, not on every new array reference.
  const teamIdsKey = useMemo(
    () =>
      teams
        .map((t: Team) => t.id)
        .sort()
        .join(','),
    [teams],
  );

  // Rosters are reactive through TeamContext, so members are refetched when any
  // team's member/admin ids change, not on every team-document push.
  const rosterKey = useMemo(
    () =>
      teams
        .map((t: Team) => `${t.id}:${[...t.members, ...t.admins].sort().join(',')}`)
        .sort()
        .join('|'),
    [teams],
  );

  // Fetch members for all teams
  useEffect(() => {
    if (!rosterKey) return;
    void Promise.all(
      rosterKey.split('|').map(async (entry) => {
        const teamId = entry.slice(0, entry.indexOf(':'));
        try {
          const members = await teamApi.getMembers(teamId);
          return [teamId, members] as [string, TeamMember[]];
        } catch {
          return [teamId, []] as [string, TeamMember[]];
        }
      }),
    ).then((entries) => setMembersByTeam(new Map(entries)));
  }, [rosterKey]);

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

  // Redmine issues are edited in their own dialog, under the user's personal
  // Redmine key. A new one is created with a ticket, in the New Ticket dialog.
  const [redmineEditIssueId, setRedmineEditIssueId] = useState<number | null>(null);

  // Links already covered by a Redmine fetch, read by the live feed below.
  const seenLinkKeys = React.useRef(new Set<string>());

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
      const items = liveDocs.map((doc) => huddleSource.toUnified(doc, sourceCtxRef.current));
      setSourceItems('huddle', items);

      // A teammate linked a ticket to an issue this page has not fetched: the
      // Redmine list must be read again for its status to show. Each link asks
      // once, so an issue this user cannot see does not refetch on every push.
      const unseen = items
        .map(linkedIssueKey)
        .filter((key): key is string => key !== null && !seenLinkKeys.current.has(key));
      if (unseen.length > 0) {
        unseen.forEach((key) => seenLinkKeys.current.add(key));
        refetchAfterRedmineWrite();
      }
    });
    const unsubscribe = ddp.subscribe('tickets.byTeam', [teamIds]);

    return () => {
      offChange();
      unsubscribe();
    };
  }, [teamIdsKey, userId, setSourceItems, refetchAfterRedmineWrite]);

  // Rebuilt, not added to: a link that was removed must ask again if it returns.
  useEffect(() => {
    seenLinkKeys.current = new Set(
      allTickets.map(linkedIssueKey).filter((key): key is string => key !== null),
    );
  }, [allTickets]);

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

  // My Board vs All Sources — same URL, local state only. My Board is where the
  // day's work is; All Sources is where more of it is looked up.
  const [activeView, setActiveView] = useState<TicketsView>('my-board');
  // The All Sources table is a few hundred rows; render it from the first visit on,
  // not while the page is opening on My Board.
  const [allSourcesOpened, setAllSourcesOpened] = useState(false);
  if (activeView === 'tickets' && !allSourcesOpened) setAllSourcesOpened(true);
  // On a phone the rows carry no checkbox until Select asks for them; the wide
  // table always has its select column, so this is only read when compact.
  const compact = useMediaQuery(COMPACT_QUERY);
  const [selecting, setSelecting] = useState(false);
  const switcherRef = React.useRef<HTMLDivElement>(null);
  // The empty board's button hides itself by switching views. Focus goes to
  // the option it selected, so a keyboard user is not dropped on the page body.
  const browseAllSources = useCallback(() => {
    setActiveView('tickets');
    requestAnimationFrame(() =>
      switcherRef.current
        ?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')
        ?.focus(),
    );
  }, []);

  // My Board membership, as identity only. Emptied and reloaded when the
  // signed-in user changes: this page stays mounted, and opens on the board.
  const { boardKeys, setBoardKeys, unavailableHuddleKeys, loadBoard, boardLoaded, boardKnown } =
    useMyBoardKeys(userId);
  // The board is the view the page opens on, so it must not say "empty" in
  // the moment before it knows what is on it.
  const boardLoading = ticketsLoading || !boardLoaded;
  // A board entry for a Redmine issue shows as the ticket linked to that issue.
  const boardTickets = useMemo(
    () => allTickets.filter((t) => isOnBoard(t, boardKeys)),
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
    const linkedKeys = new Set(allTickets.map(linkedIssueKey));
    const missing = [...boardKeys].filter((key) => !ticketByKey.has(key) && !linkedKeys.has(key));
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
    allTickets,
    ticketByKey,
    ticketsLoading,
    redmineConnected,
    unavailableRedmineIds,
    unavailableHuddleKeys,
  ]);
  const unresolvedBoardNotice = unresolvedBoard?.message ?? null;

  // Filter/sort/paginate/select — one independent pipeline per tab.
  // Resolves the assignee filter's "Me" option across both id namespaces.
  const meKeys = useMeAssigneeKeys(redmineStatus);
  const ticketsView = useTicketTableView(allTickets, meKeys);
  const boardView = useTicketTableView(boardTickets, meKeys);

  // Leaving selection mode drops the selection: with the checkboxes gone there
  // would be no way to see, or undo, what was still ticked.
  const clearTicketsSelection = ticketsView.clearSelection;
  const clearBoardSelection = boardView.clearSelection;
  const toggleSelecting = useCallback(() => {
    setSelecting((on) => !on);
    clearTicketsSelection();
    clearBoardSelection();
  }, [clearTicketsSelection, clearBoardSelection]);

  // A selection belongs to the table it was made in, at the size it was made.
  // Switching view, or crossing between the phone and wide layouts, starts
  // clean: otherwise rows ticked in the wide table stay selected on a phone
  // with no checkbox showing, and the bulk bar acts on rows nobody can see.
  const selectionScope = `${activeView}|${compact}`;
  const lastSelectionScope = React.useRef(selectionScope);
  useEffect(() => {
    if (lastSelectionScope.current === selectionScope) return;
    lastSelectionScope.current = selectionScope;
    setSelecting(false);
    clearTicketsSelection();
    clearBoardSelection();
  }, [selectionScope, clearTicketsSelection, clearBoardSelection]);

  // The search is the exception: one bar sits above both tabs, so its text is
  // one value, applied to whichever table is showing.
  const searchQuery = ticketsView.searchQuery;
  const setTicketsSearch = ticketsView.setSearchQuery;
  const setBoardSearch = boardView.setSearchQuery;
  const setSearchQuery = useCallback(
    (query: string) => {
      setTicketsSearch(query);
      setBoardSearch(query);
    },
    [setTicketsSearch, setBoardSearch],
  );

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
  const [editAssignees, setEditAssignees] = useState<string[]>([]);
  const [editPriority, setEditPriority] = useState('');

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

  // ── Ticket timers (started from either table and Redmine suggestions) ──

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
        // An issue on the board is a table row for that alone, even before the
        // refetch that lists it: nothing to pin.
        inTable: ticketByKey.has(ticket.key) || isOnBoard(ticket, boardKeys),
        onBoard: isOnBoard(ticket, boardKeys),
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

  // Redmine issues already in the table that is showing — as a row, or as the
  // issue a ticket is linked to — so "More from Redmine" offers only new ones.
  // The view that is showing, not every ticket loaded: on My Board, an issue
  // that is only in All Sources is not on screen, and leaving it out of the
  // search results as well would make it unfindable from there.
  const shownTickets = activeView === 'tickets' ? allTickets : boardTickets;
  const tableRedmineIssueIds = useMemo(
    () =>
      new Set(
        shownTickets.flatMap((t) => [
          ...(t.sourceId === 'redmine' ? [Number(t.id)] : []),
          ...(t.linked?.sourceId === 'redmine' ? [Number(t.linked.id)] : []),
        ]),
      ),
    [shownTickets],
  );
  const runningRedmineIssueId =
    runningTicket?.source === 'redmine' ? Number(runningTicket.id) : null;

  const startCreate = useCallback(() => {
    if (!selectedTeam) {
      setShowNoTeamDialog(true);
      return;
    }
    setShowCreate(true);
  }, [selectedTeam]);

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
    } catch (err) {
      // E.g. a linked ticket someone is timing: the server says whose timer it is.
      toast.error(err instanceof ApiError && err.message ? err.message : ticketLinkText.saveFailed);
    } finally {
      setEditSaving(false);
    }
  }, [editTicket, editTitle, editDescription, editAssignees, editPriority, refetch, toast]);

  // A Redmine status change goes through the edit dialog: its choices are the
  // transitions Redmine's workflow allows, not Huddle's fixed status list.
  const handleChangeStatusRequest = useCallback((t: UnifiedTicket) => {
    if (t.sourceId === 'redmine') {
      setRedmineEditIssueId(Number(t.id));
      return;
    }
    // A linked ticket shows its Redmine issue's status, so that is the status
    // to change. A viewer who cannot read the issue changes the ticket's own.
    if (t.linked?.status) {
      setRedmineEditIssueId(Number(t.linked.id));
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
    } catch (err) {
      toast.error(err instanceof ApiError && err.message ? err.message : ticketLinkText.saveFailed);
    } finally {
      setChangeStatusSaving(false);
    }
  }, [changeStatusTicket, changeStatusValue, refetch, toast]);

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

  // The writes tell every board reader to look again (`useBoardActions`); the
  // board shown here is updated at once rather than after that read.
  const boardActions = useBoardActions();

  /** Put rows on My Board. Resolves to whether they were added; a failure is toasted. */
  const addToBoard = useCallback(
    (keys: string[]) =>
      boardActions.add(keys).then((added) => {
        if (added) setBoardKeys((prev) => new Set([...prev, ...keys]));
        return added;
      }),
    [boardActions, setBoardKeys],
  );

  /** Take rows off My Board; `undoLabel` as in `useBoardActions`. */
  const removeFromBoard = useCallback(
    (keys: string[], undoLabel?: string) =>
      boardActions.remove(keys, undoLabel).then((removed) => {
        if (removed) {
          setBoardKeys((prev) => {
            const next = new Set(prev);
            for (const key of keys) next.delete(key);
            return next;
          });
        }
        return removed;
      }),
    [boardActions, setBoardKeys],
  );

  // A suggestion's board button, for an issue that may not be a table row yet.
  const boardRedmineIssueIds = useMemo(
    () =>
      new Set(
        [...boardKeys]
          .map(ticketRefOf)
          .filter((ref) => ref.sourceId === 'redmine')
          .map((ref) => Number(ref.ticketId)),
      ),
    [boardKeys],
  );
  const handleSuggestionBoard = useCallback(
    (issue: RedmineIssue) => {
      const key = ticketKey('redmine', String(issue.id));
      return boardKeys.has(key)
        ? removeFromBoard([key], timerLabel('redmine', String(issue.id)))
        : addToBoard([key]);
    },
    [boardKeys, addToBoard, removeFromBoard],
  );

  // One row's board button: on puts it there, off takes it away again.
  const [boardLoadingKey, setBoardLoadingKey] = useState<string | null>(null);
  const handleToggleBoard = useCallback(
    (ticket: UnifiedTicket) => {
      const entryKeys = boardEntryKeys(ticket, boardKeys);
      setBoardLoadingKey(ticket.key);
      void (
        entryKeys.length > 0
          ? removeFromBoard(entryKeys, timerLabel(ticket.sourceId, ticket.id, ticket.title))
          : addToBoard([ticket.key])
      ).finally(() => setBoardLoadingKey(null));
    },
    [boardKeys, addToBoard, removeFromBoard],
  );

  const handleMoveToBoard = useCallback(() => {
    void addToBoard([...ticketsView.selectedKeys]).then(
      (added) => added && ticketsView.clearSelection(),
    );
  }, [addToBoard, ticketsView]);

  // ── First fill of an empty board ──
  // The assigned issues not on the board yet: what the button adds from, and
  // what the notice counts afterwards.
  const assignedIssues = useMemo(() => assignedToMe(allTickets, meKeys), [allTickets, meKeys]);
  const assignedOffBoard = useMemo(
    () => assignedIssues.filter((t) => !boardKeys.has(t.key)),
    [assignedIssues, boardKeys],
  );
  const assignedNotice = useAssignedNotice(userId);
  const showAssignedNotice = assignedNotice.show;
  const [gettingAssigned, setGettingAssigned] = useState(false);
  // For the first fill only: once the board holds anything, more is added by
  // searching or from All Sources.
  // Only for a board known to be empty: after a failed read it merely looks so.
  const offerAssigned = boardKnown && boardKeys.size === 0 && assignedOffBoard.length > 0;

  const handleGetAssigned = useCallback(() => {
    const keys = assignedOffBoard.slice(0, STARTER_LIMIT).map((t) => t.key);
    const moreRemain = assignedOffBoard.length > keys.length;
    setGettingAssigned(true);
    void addToBoard(keys)
      .then((added) => added && moreRemain && showAssignedNotice())
      .finally(() => setGettingAssigned(false));
  }, [assignedOffBoard, addToBoard, showAssignedNotice]);

  /** All Sources, narrowed to the user's assigned issues. */
  const showAssignedInAllSources = useCallback(() => {
    setSearchQuery('');
    ticketsView.setFilters(ASSIGNED_FILTERS);
    ticketsView.setShowClosed(false);
    browseAllSources();
  }, [setSearchQuery, ticketsView, browseAllSources]);

  const handleRemoveFromBoard = useCallback(() => {
    // A ticket can be on the board through the issue it is linked to; taking
    // the ticket off has to take that entry off too.
    const keys = [...boardView.selectedKeys].flatMap((key) => {
      const ticket = ticketByKey.get(key);
      return ticket ? boardEntryKeys(ticket, boardKeys) : [key];
    });
    void removeFromBoard(keys).then((removed) => removed && boardView.clearSelection());
  }, [boardView, ticketByKey, boardKeys, removeFromBoard]);

  const noFocusRingClass =
    'ring-0 focus:ring-0 focus-visible:ring-0 focus:outline-none focus-visible:outline-none focus:border-blue-300 focus-visible:border-blue-300';

  const newTicketButton = (
    <Button
      variant="primary"
      size="sm"
      leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
      // Teams arrive asynchronously, so selectedTeam is null on first
      // paint even for users who have one. Without this guard an early
      // click reports "No team available" to a user who has a team.
      disabled={!teamsReady}
      onClick={startCreate}
      // The label shortens to "Ticket" on a phone, where the search bar needs
      // the width; the name stays whole for assistive tech.
      aria-label={viewText.newTicket}
      className="shrink-0 rounded-lg"
    >
      <span className="max-sm:hidden">{viewText.newTicketPrefix}</span>
      {viewText.ticket}
    </Button>
  );

  // What both tabs' tables share; each tab adds its own view and labels.
  const sharedTableProps = {
    selecting,
    errors: sourceErrors,
    isCreator: (t: UnifiedTicket) => t.createdBy?.id === userId,
    runningTicketKey: runningTicket?.key ?? null,
    timerLoadingKey,
    onToggleTimer: handleToggleTimer,
    isOnBoard: (t: UnifiedTicket) => isOnBoard(t, boardKeys),
    boardKnown,
    boardLoadingKey,
    onToggleBoard: handleToggleBoard,
    onEditRequest: (t: UnifiedTicket) => void openEditModal(t),
    onDeleteRequest: (t: UnifiedTicket) => requestDelete([t]),
    onChangeStatusRequest: handleChangeStatusRequest,
  };

  return (
    <AppPage fill width="full">
      <h1 className="sr-only">Tickets</h1>

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="tickets-views flex min-h-0 flex-1 flex-col">
          <div
            ref={switcherRef}
            className="tickets-view-switcher mb-1.5 flex shrink-0 items-center justify-between gap-2"
          >
            <SegmentedSwitcher
              name="tickets-view"
              label={viewText.switcherLabel}
              hideLabel
              // Beside the Select button on a phone, so it takes that button's height.
              compact={compact}
              options={VIEW_OPTIONS}
              value={activeView}
              onValueChange={setActiveView}
            />
            {compact && (
              <Button
                variant={selecting ? 'primary' : 'secondary'}
                size="sm"
                aria-pressed={selecting}
                rightIcon={<CheckCheck className="h-4 w-4" aria-hidden="true" />}
                onClick={toggleSelecting}
                className="tickets-select-toggle shrink-0 rounded-lg"
              >
                {selecting ? viewText.doneSelecting : viewText.select}
              </Button>
            )}
          </div>

          {/* One toolbar for both views: it stays put when the tab changes. */}
          <div className="tickets-toolbar sticky top-0 z-20 -mx-4 mb-3 flex shrink-0 items-center gap-2 border-b border-neutral-200 bg-neutral-50/95 px-4 py-2 backdrop-blur supports-backdrop-filter:bg-neutral-50/80 dark:border-neutral-800 dark:bg-neutral-950/95 dark:supports-backdrop-filter:bg-neutral-950/80 md:static md:z-auto md:mx-0 md:border-0 md:bg-transparent md:px-0 md:py-0">
            {newTicketButton}

            <RedmineSuggestions
              userId={userId}
              query={searchQuery}
              onQueryChange={setSearchQuery}
              baseUrl={redmineBaseUrl}
              tableIssueIds={tableRedmineIssueIds}
              runningIssueId={runningRedmineIssueId}
              onToggleTimer={handleSuggestionTimer}
              boardIssueIds={boardRedmineIssueIds}
              boardKnown={boardKnown}
              onToggleBoard={handleSuggestionBoard}
              inputClassName={`ps-8 rounded-lg ${noFocusRingClass}`}
            />

            <TicketViewControls
              view={activeView === 'tickets' ? ticketsView : boardView}
              loading={activeView === 'tickets' ? ticketsLoading : boardLoading}
            />
          </div>

          {/* ── All Sources tab ── */}
          {allSourcesOpened && (
            <section
              aria-label={viewText.allSources}
              className={viewPanelClass(activeView === 'tickets')}
            >
              <TicketTablePanel
                {...sharedTableProps}
                view={ticketsView}
                loading={ticketsLoading}
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
            </section>
          )}

          {/* ── My Board tab ── */}
          <section
            aria-label={viewText.myBoard}
            className={viewPanelClass(activeView === 'my-board')}
          >
            <TicketTablePanel
              {...sharedTableProps}
              boardView
              view={boardView}
              loading={boardLoading}
              // Unresolvable board entries, announced politely.
              afterBulkBar={
                <>
                  {/* Counted against the board, so not until the board is known. */}
                  {boardKnown && assignedNotice.open && assignedOffBoard.length > 0 && (
                    <div
                      role="status"
                      className="board-assigned-notice flex flex-wrap items-center gap-x-2 gap-y-1"
                    >
                      <Text size="xs" variant="muted">
                        {starterText.moreAssigned(
                          assignedOffBoard.length,
                          isApproximate(assignedIssues),
                        )}
                      </Text>
                      {/* The link stays with the sentence; Dismiss goes to the far end. */}
                      <ButtonGroup split className="board-assigned-notice-actions flex-1">
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto p-0 text-xs"
                          onClick={showAssignedInAllSources}
                          aria-label={starterText.showThemLabel}
                        >
                          {starterText.showThem}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={assignedNotice.dismiss}
                          aria-label={starterText.dismiss}
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      </ButtonGroup>
                    </div>
                  )}
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
                </>
              }
              canDeleteSelected={canDeleteSelection(boardView.selectedKeys)}
              onBulkDelete={() => handleBulkDeleteRequest(boardView.selectedKeys)}
              primaryLabel="Remove from My Board"
              onPrimaryAction={handleRemoveFromBoard}
              emptyText={{
                open: 'Your board is empty',
                closed: 'No closed tickets on your board',
                hint: viewText.emptyBoardHint,
              }}
              // Wraps on a phone, where the two labels do not fit one row.
              emptyAction={
                <ButtonGroup className="empty-board-actions max-w-full flex-wrap justify-center gap-2">
                  {offerAssigned && (
                    <Button
                      variant="primary"
                      size="sm"
                      leftIcon={<UserRoundArrowLeft className="h-4 w-4" aria-hidden="true" />}
                      isLoading={gettingAssigned}
                      loadingText={starterText.getting}
                      onClick={handleGetAssigned}
                    >
                      {starterText.getAssigned}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    leftIcon={<Binoculars className="h-4 w-4" aria-hidden="true" />}
                    onClick={browseAllSources}
                  >
                    {viewText.browseAllSources}
                  </Button>
                </ButtonGroup>
              }
              emptyNotice={unresolvedBoardNotice}
            />
          </section>
        </div>

        {/* Edit ticket modal (creator only) */}
        <Modal open={!!editTicket} onOpenChange={(open) => !open && setEditTicket(null)}>
          <ModalHeader>
            <ModalTitle>Edit Ticket</ModalTitle>
            <ModalClose />
          </ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              <Input
                label="Title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className={noFocusRingClass}
                autoFocus
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
          // A new ticket is put on its creator's My Board by the server.
          onCreated={() => {
            void refetch();
            loadBoard();
          }}
          teams={teams}
          defaultTeamId={selectedTeam?.id ?? null}
          userId={userId}
        />
        <RedmineIssueEditModal
          issueId={redmineEditIssueId}
          onClose={() => setRedmineEditIssueId(null)}
          onSaved={refetchAfterRedmineWrite}
        />
      </div>
    </AppPage>
  );
};
