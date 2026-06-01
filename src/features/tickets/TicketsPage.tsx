/**
 * TicketsPage — CRUD ticket management.
 *
 * Features:
 *   • Create ticket (title + optional GitHub URL)
 *   • Edit title/GitHub link
 *   • Delete tickets
 *   • Search/filter
 *   • Status badge display
 *
 * Ticket-level timer tracking has moved to the Timers page (/app/work).
 */
import {
  faChevronDown,
  faEllipsisVertical,
  faExternalLink,
  faEye,
  faPen,
  faCircleCheck,
  faCircleDot,
  faCircleXmark,
  faPlus,
  faRightLeft,
  faSearch,
  faShareFromSquare,
  faTrash,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Button,
  Card,
  CardContent,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownSeparator,
  Input,
  Modal,
  ModalBody,
  ModalClose,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Select,
  Spinner,
  Text,
  Textarea,
  type DropdownPlacement,
} from '@mieweb/ui';
import { Capacitor } from '@capacitor/core';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import {
  teamApi,
  ticketApi,
  shareTicketWithTimeharbor,
  type Team,
  type TeamMember,
  type Ticket,
} from '../../lib/api';
import { useTeam } from '../../lib/TeamContext';
import { useSession } from '../../lib/useSession';
import { useRefresh } from '../../lib/RefreshContext';
import { useRouter } from '../../ui/router';
import { AppPage } from '../../ui/AppPage';
import { UserAvatar } from '../../ui/UserAvatar';
import { AttachmentsPanel } from '../clock/AttachmentsPanel';
import { PulseUploadButton } from '../media/PulseUploadButton';
import { fetchGithubIssue, isGithubIssueUrl } from './githubIssue';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'in-progress', label: 'In Progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'closed', label: 'Completed' },
  { value: 'reviewed', label: 'Reviewed' },
];

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

function statusIconFor(status: string | null | undefined): {
  icon: typeof faCircleDot;
  className: string;
} {
  const s = status ?? 'open';
  if (s === 'closed' || s === 'reviewed')
    return { icon: faCircleCheck, className: 'text-purple-500' };
  if (s === 'blocked') return { icon: faCircleXmark, className: 'text-amber-500' };
  return { icon: faCircleDot, className: 'text-green-500' };
}

function priorityLabelClass(priority: string): string {
  if (priority === 'critical')
    return 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400';
  if (priority === 'high')
    return 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400';
  if (priority === 'medium')
    return 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-400';
  return 'border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400';
}

function statusLabelClass(status: string): string {
  if (status === 'in-progress')
    return 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-400';
  if (status === 'blocked')
    return 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400';
  return 'border-neutral-200 bg-neutral-100 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400';
}

async function fetchIssueTitle(url: string): Promise<string | null> {
  const issue = await fetchGithubIssue(url);
  return issue?.title ?? null;
}

// ─── TicketRow ─────────────────────────────────────────────────────────────────

interface TicketRowProps {
  ticket: Ticket;
  isCreator: boolean;
  assigneeName: string | null;
  assigneeId: string | null;
  createdByName: string | null;
  suppressAvatars?: boolean;
  onEditRequest: (ticket: Ticket) => void;
  onDeleteRequest: (id: string) => void;
  onChangeStatusRequest: (ticket: Ticket) => void;
  onShareWithTimeharbor: (ticket: Ticket, shared: boolean) => void;
}

const TicketRow: React.FC<TicketRowProps> = ({
  ticket,
  isCreator,
  assigneeName,
  assigneeId,
  createdByName,
  suppressAvatars = false,
  onEditRequest,
  onDeleteRequest,
  onChangeStatusRequest,
  onShareWithTimeharbor,
}) => {
  const { navigate } = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const { icon, className: iconClass } = statusIconFor(ticket.status);
  const showStatusLabel =
    ticket.status &&
    ticket.status !== 'open' &&
    ticket.status !== 'closed' &&
    ticket.status !== 'reviewed';
  const statusLabel = STATUS_OPTIONS.find((s) => s.value === ticket.status)?.label;

  return (
    <li
      data-ticket-id={ticket.id}
      className="group relative flex items-start gap-3 px-4 py-3 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
    >
      {/* Status icon */}
      <div className="mt-0.5 shrink-0 pt-0.5">
        <FontAwesomeIcon icon={icon} className={`text-base ${iconClass}`} />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        {/* Title + label badges */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            className="text-left text-sm font-semibold text-neutral-900 hover:text-primary dark:text-neutral-100 dark:hover:text-primary"
            onClick={() => navigate(`/app/tickets/${ticket.id}`)}
          >
            {ticket.title}
          </button>
          {ticket.priority && (
            <span
              className={`inline-flex items-center rounded-full border px-1.5 py-px text-[11px] font-medium ${priorityLabelClass(ticket.priority)}`}
            >
              {ticket.priority}
            </span>
          )}
          {showStatusLabel && statusLabel && (
            <span
              className={`inline-flex items-center rounded-full border px-1.5 py-px text-[11px] font-medium ${statusLabelClass(ticket.status)}`}
            >
              {statusLabel}
            </span>
          )}
          {ticket.sharedWithTimeharbor && (
            <span
              className="inline-flex items-center rounded-full border border-blue-300 bg-blue-50 px-1.5 py-px text-[11px] font-medium text-blue-700 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-400"
              title="Shared with TimeHarbor"
              aria-label="Shared with TimeHarbor"
            >
              TH
            </span>
          )}
        </div>

        {/* Metadata line */}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-neutral-500 dark:text-neutral-400">
          <span>
            #{ticket.id.slice(-5)} opened {timeAgo(ticket.createdAt)} by{' '}
            {createdByName ?? `user-${ticket.createdBy.slice(-4)}`}
          </span>
          {assigneeName && <span>· assigned to {assigneeName}</span>}
          {ticket.github && (
            <a
              href={ticket.github}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:text-blue-500 hover:underline"
            >
              <FontAwesomeIcon icon={faExternalLink} className="text-[10px]" />
              {ticket.github.includes('github.com') ? 'GitHub' : 'Issue link'}
            </a>
          )}
        </div>
      </div>

      {/* Right side: assignee avatar + overflow menu */}
      <div className="flex shrink-0 items-center gap-2">
        {!suppressAvatars && assigneeName && assigneeId && (
          <button
            className="rounded-full ring-offset-1 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => navigate(`/app/profile/${assigneeId}`)}
            aria-label={`View ${assigneeName}'s profile`}
            title={assigneeName}
          >
            <UserAvatar name={assigneeName} size="xs" />
          </button>
        )}
        <Dropdown
          className="z-1000 bg-white dark:bg-neutral-800"
          open={menuOpen}
          onOpenChange={setMenuOpen}
          trigger={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Ticket options"
              className="opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
            >
              <FontAwesomeIcon icon={faEllipsisVertical} className="text-sm" />
            </Button>
          }
          placement="bottom-end"
        >
          <DropdownContent>
            <DropdownItem
              icon={<FontAwesomeIcon icon={faEye} />}
              onClick={() => {
                setMenuOpen(false);
                navigate(`/app/tickets/${ticket.id}`);
              }}
            >
              Ticket Details
            </DropdownItem>
            {isCreator && (
              <DropdownItem
                icon={<FontAwesomeIcon icon={faPen} />}
                onClick={() => {
                  setMenuOpen(false);
                  onEditRequest(ticket);
                }}
              >
                Edit Ticket
              </DropdownItem>
            )}
            <DropdownItem
              icon={<FontAwesomeIcon icon={faRightLeft} />}
              onClick={() => {
                setMenuOpen(false);
                onChangeStatusRequest(ticket);
              }}
            >
              Change Status
            </DropdownItem>
            <DropdownItem
              icon={<FontAwesomeIcon icon={faShareFromSquare} />}
              onClick={() => {
                setMenuOpen(false);
                onShareWithTimeharbor(ticket, !ticket.sharedWithTimeharbor);
              }}
            >
              {ticket.sharedWithTimeharbor ? 'Remove from TimeHarbor' : 'Send to TimeHarbor'}
            </DropdownItem>
            {isCreator && (
              <>
                <DropdownSeparator />
                <DropdownItem
                  icon={<FontAwesomeIcon icon={faTrash} />}
                  variant="danger"
                  onClick={() => {
                    setMenuOpen(false);
                    onDeleteRequest(ticket.id);
                  }}
                >
                  Delete Ticket
                </DropdownItem>
              </>
            )}
          </DropdownContent>
        </Dropdown>
      </div>
    </li>
  );
};

// ─── Filter dropdown helper ───────────────────────────────────────────────────

interface FilterDropdownProps {
  label: string;
  activeLabel: string | null;
  placement?: DropdownPlacement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

const FilterDropdown: React.FC<FilterDropdownProps> = ({
  label,
  activeLabel,
  placement = 'bottom-start',
  open,
  onOpenChange,
  children,
}) => (
  <Dropdown
    trigger={
      <button
        className={`flex items-center gap-1 text-xs font-medium transition-colors ${
          activeLabel
            ? 'text-neutral-900 dark:text-neutral-100'
            : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
        }`}
      >
        {activeLabel ? `${label}: ${activeLabel}` : label}
        <FontAwesomeIcon icon={faChevronDown} className="text-[10px]" />
      </button>
    }
    placement={placement}
    open={open}
    onOpenChange={onOpenChange}
    className="z-1000 max-w-[calc(100vw-1rem)] bg-white dark:bg-neutral-800"
  >
    <DropdownContent className="max-h-[60vh] overflow-y-auto">{children}</DropdownContent>
  </Dropdown>
);

// ─── Ticket skeleton rows ─────────────────────────────────────────────────────

const TicketSkeletonRow: React.FC<{ wide?: boolean }> = ({ wide }) => (
  <li className="flex items-start gap-3 px-4 py-3">
    <div className="mt-1 h-3.5 w-3.5 shrink-0 animate-pulse rounded-full bg-neutral-200 dark:bg-neutral-700" />
    <div className="min-w-0 flex-1 space-y-2">
      <div
        className={`h-3.5 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700 ${wide ? 'w-2/3' : 'w-1/2'}`}
      />
      <div className="h-2.5 w-1/3 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />
    </div>
  </li>
);

const TicketListSkeleton: React.FC = () => (
  <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
    <TicketSkeletonRow wide />
    <TicketSkeletonRow />
    <TicketSkeletonRow wide />
    <TicketSkeletonRow />
    <TicketSkeletonRow wide />
  </ul>
);

export const TicketsPage: React.FC = () => {
  const { user } = useSession();
  const userId = user?.id ?? null;
  const { teams, selectedTeamId, teamsReady } = useTeam();

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);
  // Map from teamId → members for cross-team member lookups
  const [membersByTeam, setMembersByTeam] = useState<Map<string, TeamMember[]>>(new Map());

  const refetch = useCallback(async () => {
    if (!teams.length) {
      setTickets([]);
      setTicketsLoading(false);
      return;
    }
    try {
      const results = await Promise.all(teams.map((t) => ticketApi.getTickets(t.id)));
      // Deduplicate by id in case a ticket appears in multiple team responses
      const seen = new Set<string>();
      const merged: Ticket[] = [];
      for (const batch of results) {
        for (const ticket of batch) {
          if (!seen.has(ticket.id)) {
            seen.add(ticket.id);
            merged.push(ticket);
          }
        }
      }
      setTickets(merged);
    } catch {
      // keep previous tickets on error
    } finally {
      setTicketsLoading(false);
    }
  }, [teams]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Pull-to-refresh handler
  useRefresh(refetch);

  // Real-time WebSocket connection for ticket updates
  useEffect(() => {
    if (!teams.length || !userId) return;

    const teamIds = teams.map((t) => t.id);
    const ws = ticketApi.openLiveStream(teamIds);

    ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'snapshot') {
          // Initial snapshot for a single team — merge with existing tickets
          const newTickets = data.tickets as Ticket[];
          setTickets((prev) => {
            // Remove tickets from this team, then add the snapshot
            const filtered = prev.filter((t) => t.teamId !== data.teamId);
            return [...filtered, ...newTickets];
          });
        } else if (data.type === 'update') {
          // Real-time ticket update — upsert by id
          const updatedTicket = data.ticket as Ticket;
          setTickets((prev) => {
            const idx = prev.findIndex((t) => t.id === updatedTicket.id);
            if (idx >= 0) {
              const copy = [...prev];
              copy[idx] = updatedTicket;
              return copy;
            }
            return [...prev, updatedTicket];
          });
        } else if (data.type === 'delete') {
          // Ticket deleted — remove from state
          setTickets((prev) => prev.filter((t) => t.id !== data.ticketId));
        }
      } catch (err) {
        console.warn('Failed to parse tickets WebSocket message:', err);
      }
    };

    // Cleanup: close WebSocket when teams change or component unmounts
    return () => {
      ws.close();
    };
  }, [teams, userId]);

  // Listen for external refetch requests (e.g., from CommandPalette)
  useEffect(() => {
    const onRefetch = () => void refetch();
    window.addEventListener('tickets:refetch', onRefetch);
    return () => window.removeEventListener('tickets:refetch', onRefetch);
  }, [refetch]);

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

  // Mutation loading states
  const [createLoading, setCreateLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  // Create state
  const [showCreate, setShowCreate] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createGithub, setCreateGithub] = useState('');
  const [createTitleFetching, setCreateTitleFetching] = useState(false);
  const createFetchTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Search + filter
  const [searchQuery, setSearchQuery] = useState('');
  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);
  const [statusDetailFilter, setStatusDetailFilter] = useState<string | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<string | null>(null);
  const [openFilterMenu, setOpenFilterMenu] = useState<
    'team' | 'priority' | 'status' | 'assignee' | null
  >(null);
  const ticketListRef = React.useRef<HTMLUListElement | null>(null);
  const [suppressedAvatarIds, setSuppressedAvatarIds] = useState<string[]>([]);

  // Delete state
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Edit modal state (creator only)
  const [editTicket, setEditTicket] = useState<Ticket | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editGithub, setEditGithub] = useState('');
  const [editAssignee, setEditAssignee] = useState('');
  const [editPriority, setEditPriority] = useState('');
  const [titleFetching, setTitleFetching] = useState(false);
  const editFetchTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Change status modal (any team member)
  const [changeStatusTicket, setChangeStatusTicket] = useState<Ticket | null>(null);
  const [changeStatusValue, setChangeStatusValue] = useState('');
  const [changeStatusSaving, setChangeStatusSaving] = useState(false);

  // Ticket details modal (read-only)
  const [detailsTicket, setDetailsTicket] = useState<Ticket | null>(null);
  const [detailsAttachmentRefresh, setDetailsAttachmentRefresh] = useState(0);

  // Status filter: Open vs Closed (GitHub style)
  type StatusFilter = 'open' | 'closed';
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');

  // Filter tickets by search + team + assignee
  const searchFilteredTickets = useMemo(() => {
    let result = tickets;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (t) => t.title.toLowerCase().includes(q) || t.github?.toLowerCase().includes(q),
      );
    }
    if (teamFilter) {
      result = result.filter((t) => t.teamId === teamFilter);
    }
    if (assigneeFilter === '__unassigned__') {
      result = result.filter((t) => !t.assignedTo);
    } else if (assigneeFilter) {
      result = result.filter((t) => t.assignedTo === assigneeFilter);
    }
    if (statusDetailFilter) {
      result = result.filter((t) => (t.status ?? 'open') === statusDetailFilter);
    }
    if (priorityFilter) {
      result = result.filter((t) => (t.priority ?? '') === priorityFilter);
    }
    return result;
  }, [tickets, searchQuery, teamFilter, assigneeFilter, statusDetailFilter, priorityFilter]);

  // Open vs closed counts (GitHub-style header tabs)
  const openCount = useMemo(
    () =>
      searchFilteredTickets.filter(
        (t) => !t.status || (t.status !== 'closed' && t.status !== 'reviewed'),
      ).length,
    [searchFilteredTickets],
  );
  const closedCount = useMemo(
    () =>
      searchFilteredTickets.filter((t) => t.status === 'closed' || t.status === 'reviewed').length,
    [searchFilteredTickets],
  );

  // Filter tickets by status tab
  const filteredTickets = useMemo(() => {
    if (statusFilter === 'closed')
      return searchFilteredTickets.filter((t) => t.status === 'closed' || t.status === 'reviewed');
    // 'open' = everything that isn't closed
    return searchFilteredTickets.filter(
      (t) => !t.status || (t.status !== 'closed' && t.status !== 'reviewed'),
    );
  }, [searchFilteredTickets, statusFilter]);

  // When a filter menu is open on desktop web, suppress only row avatars that
  // visually intersect with that floating menu area.
  useEffect(() => {
    if (!openFilterMenu) {
      setSuppressedAvatarIds([]);
      return;
    }
    if (openFilterMenu === 'team' || openFilterMenu === 'status') {
      setSuppressedAvatarIds([]);
      return;
    }
    if (Capacitor.isNativePlatform() || window.innerWidth < 768) {
      setSuppressedAvatarIds([]);
      return;
    }

    const listEl = ticketListRef.current;
    if (!listEl) {
      setSuppressedAvatarIds([]);
      return;
    }

    const updateSuppressedRows = () => {
      const menuEl = document.querySelector('[role="menu"]') as HTMLElement | null;
      if (!menuEl) {
        setSuppressedAvatarIds([]);
        return;
      }

      const menuRect = menuEl.getBoundingClientRect();
      const ids: string[] = [];
      const rows = listEl.querySelectorAll<HTMLLIElement>('li[data-ticket-id]');

      rows.forEach((row) => {
        const rowRect = row.getBoundingClientRect();
        const overlapsMenu = rowRect.top < menuRect.bottom && rowRect.bottom > menuRect.top;
        if (overlapsMenu && row.dataset.ticketId) ids.push(row.dataset.ticketId);
      });

      setSuppressedAvatarIds(ids);
    };

    const rafId = window.requestAnimationFrame(updateSuppressedRows);
    const scrollHost = listEl.closest('main');

    scrollHost?.addEventListener('scroll', updateSuppressedRows, { passive: true });
    window.addEventListener('resize', updateSuppressedRows, { passive: true });

    return () => {
      window.cancelAnimationFrame(rafId);
      scrollHost?.removeEventListener('scroll', updateSuppressedRows);
      window.removeEventListener('resize', updateSuppressedRows);
    };
  }, [openFilterMenu, filteredTickets.length]);

  // Member options for assignee select in the edit modal
  const memberOptions = useMemo(() => {
    const teamId = selectedTeamId ?? teams[0]?.id;
    const members = teamId ? (membersByTeam.get(teamId) ?? []) : [];
    return [
      { value: '', label: 'Unassigned' },
      ...members.map((m) => ({ value: m.id, label: m.name || m.email })),
    ];
  }, [membersByTeam, selectedTeamId, teams]);

  // Active filter label helpers
  const activeTeamLabel = useMemo(
    () => (teamFilter ? (teams.find((t: Team) => t.id === teamFilter)?.name ?? null) : null),
    [teamFilter, teams],
  );
  const activeStatusDetailLabel = useMemo(
    () =>
      statusDetailFilter
        ? (STATUS_OPTIONS.find((s) => s.value === statusDetailFilter)?.label ?? null)
        : null,
    [statusDetailFilter],
  );
  const activePriorityLabel = useMemo(
    () =>
      priorityFilter
        ? (PRIORITY_OPTIONS.find((p) => p.value === priorityFilter)?.label ?? null)
        : null,
    [priorityFilter],
  );
  const activeAssigneeLabel = useMemo(() => {
    if (!assigneeFilter) return null;
    if (assigneeFilter === '__unassigned__') return 'Unassigned';
    return getAssigneeName(assigneeFilter) ?? null;
  }, [assigneeFilter, getAssigneeName]);

  // Members sorted with current user first
  const sortedMembers = useMemo(() => {
    const me = allMembers.find((m) => m.id === userId);
    const rest = allMembers.filter((m) => m.id !== userId);
    return me ? [me, ...rest] : rest;
  }, [allMembers, userId]);

  // ── Handlers ──

  const handleCreate = useCallback(async () => {
    if (!createTitle.trim() || !selectedTeamId) return;
    setCreateLoading(true);
    try {
      await ticketApi.createTicket({
        teamId: selectedTeamId,
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
  }, [createTitle, createGithub, selectedTeamId, refetch]);

  const openEditModal = (ticket: Ticket) => {
    setEditTicket(ticket);
    setEditTitle(ticket.title);
    setEditDescription(ticket.description || '');
    setEditGithub(ticket.github || '');
    setEditAssignee(ticket.assignedTo || '');
    setEditPriority(ticket.priority || '');
  };

  const handleSaveEdit = useCallback(async () => {
    if (!editTicket || !editTitle.trim()) return;
    setEditSaving(true);
    try {
      await ticketApi.updateTicket(editTicket.id, {
        title: editTitle.trim(),
        description: editDescription.trim() || undefined,
        github: editGithub.trim() || undefined,
      });
      if (editAssignee !== (editTicket.assignedTo || '')) {
        await ticketApi.assignTicket(editTicket.id, editAssignee || null);
      }
      if (editPriority !== (editTicket.priority || '')) {
        await ticketApi.updateStatusPriority(editTicket.id, {
          priority: editPriority || undefined,
        });
      }
      setEditTicket(null);
      void refetch();
    } finally {
      setEditSaving(false);
    }
  }, [editTicket, editTitle, editDescription, editGithub, editAssignee, editPriority, refetch]);

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
    if (!deleteId) return;
    setDeleteLoading(true);
    try {
      await ticketApi.deleteTicket(deleteId);
      setDeleteId(null);
      void refetch();
    } finally {
      setDeleteLoading(false);
    }
  }, [deleteId, refetch]);

  const noFocusRingClass =
    'ring-0 focus:ring-0 focus-visible:ring-0 focus:outline-none focus-visible:outline-none focus:border-blue-300 focus-visible:border-blue-300';

  if (!teamsReady) {
    return (
      <div className="flex items-center justify-center p-12">
        <Spinner size="lg" label="Loading…" />
      </div>
    );
  }

  return (
    <AppPage fullWidth className="flex h-full min-h-0 flex-col">
      {/* ── Header: New Ticket + Search ── */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
        <div className="sticky top-0 z-20 -mx-4 border-b border-neutral-200 bg-neutral-50/95 px-4 py-2 backdrop-blur supports-backdrop-filter:bg-neutral-50/80 dark:border-neutral-800 dark:bg-neutral-950/95 dark:supports-backdrop-filter:bg-neutral-950/80 md:static md:z-auto md:mx-0 md:border-0 md:bg-transparent md:px-0 md:py-0">
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              leftIcon={<FontAwesomeIcon icon={faPlus} />}
              onClick={() => setShowCreate(true)}
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
                  disabled={!createTitle.trim()}
                >
                  Create Ticket
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* ── Unified ticket list (GitHub style) ── */}
        <Card padding="none" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* GitHub-style header: Open / Closed tabs + filter dropdowns */}
          <div
            className={`sticky top-0 z-30 px-4 py-4 md:relative md:top-auto md:z-30 ${Capacitor.isNativePlatform() ? 'border-b border-neutral-200 bg-neutral-50/95 backdrop-blur supports-backdrop-filter:bg-neutral-50/80 dark:border-neutral-700 dark:bg-neutral-950/95 dark:supports-backdrop-filter:bg-neutral-950/80' : 'rounded-t-xl border-b border-neutral-200 bg-neutral-50/95 backdrop-blur supports-backdrop-filter:bg-neutral-50/80 dark:border-neutral-700 dark:bg-neutral-800/70 dark:supports-backdrop-filter:bg-neutral-800/50'}`}
          >
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-2">
              {/* Left: status tabs */}
              <div className="flex items-center gap-4">
                <button
                  role="tab"
                  aria-selected={statusFilter === 'open'}
                  onClick={() => setStatusFilter('open')}
                  className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${
                    statusFilter === 'open'
                      ? 'text-neutral-900 dark:text-neutral-100'
                      : 'text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300'
                  }`}
                >
                  <FontAwesomeIcon icon={faCircleDot} className="text-green-500" />
                  {openCount} Open
                </button>
                <button
                  role="tab"
                  aria-selected={statusFilter === 'closed'}
                  onClick={() => setStatusFilter('closed')}
                  className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${
                    statusFilter === 'closed'
                      ? 'text-neutral-900 dark:text-neutral-100'
                      : 'text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300'
                  }`}
                >
                  <FontAwesomeIcon icon={faCircleCheck} className="text-purple-500" />
                  {closedCount} Closed
                </button>
              </div>

              {/* Right: filter dropdowns */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 md:pl-0">
                {teams.length > 1 && (
                  <FilterDropdown
                    label="Team"
                    activeLabel={activeTeamLabel}
                    open={openFilterMenu === 'team'}
                    onOpenChange={(open) => setOpenFilterMenu(open ? 'team' : null)}
                  >
                    <DropdownItem
                      onClick={() => setTeamFilter(null)}
                      className={!teamFilter ? 'font-semibold' : ''}
                    >
                      All teams
                    </DropdownItem>
                    <DropdownSeparator />
                    {teams.map((t: Team) => (
                      <DropdownItem
                        key={t.id}
                        onClick={() => setTeamFilter(t.id)}
                        className={teamFilter === t.id ? 'font-semibold' : ''}
                      >
                        {t.name}
                      </DropdownItem>
                    ))}
                  </FilterDropdown>
                )}
                <FilterDropdown
                  label="Priority"
                  activeLabel={activePriorityLabel}
                  open={openFilterMenu === 'priority'}
                  onOpenChange={(open) => setOpenFilterMenu(open ? 'priority' : null)}
                >
                  <DropdownItem
                    onClick={() => setPriorityFilter(null)}
                    className={!priorityFilter ? 'font-semibold' : ''}
                  >
                    Any priority
                  </DropdownItem>
                  <DropdownSeparator />
                  {PRIORITY_OPTIONS.map((p) => (
                    <DropdownItem
                      key={p.value}
                      onClick={() => setPriorityFilter(priorityFilter === p.value ? null : p.value)}
                      className={priorityFilter === p.value ? 'font-semibold' : ''}
                    >
                      {p.label}
                    </DropdownItem>
                  ))}
                </FilterDropdown>
                <FilterDropdown
                  label="Status"
                  activeLabel={activeStatusDetailLabel}
                  placement="bottom-end"
                  open={openFilterMenu === 'status'}
                  onOpenChange={(open) => setOpenFilterMenu(open ? 'status' : null)}
                >
                  <DropdownItem
                    onClick={() => setStatusDetailFilter(null)}
                    className={!statusDetailFilter ? 'font-semibold' : ''}
                  >
                    Any status
                  </DropdownItem>
                  <DropdownSeparator />
                  {STATUS_OPTIONS.filter(
                    (s) => s.value !== 'open' && s.value !== 'closed' && s.value !== 'reviewed',
                  ).map((s) => (
                    <DropdownItem
                      key={s.value}
                      onClick={() =>
                        setStatusDetailFilter(statusDetailFilter === s.value ? null : s.value)
                      }
                      className={statusDetailFilter === s.value ? 'font-semibold' : ''}
                    >
                      {s.label}
                    </DropdownItem>
                  ))}
                </FilterDropdown>
                <FilterDropdown
                  label="Assignee"
                  activeLabel={activeAssigneeLabel}
                  placement="bottom-end"
                  open={openFilterMenu === 'assignee'}
                  onOpenChange={(open) => setOpenFilterMenu(open ? 'assignee' : null)}
                >
                  <DropdownItem
                    onClick={() => setAssigneeFilter(null)}
                    className={assigneeFilter === null ? 'font-semibold' : ''}
                  >
                    Any
                  </DropdownItem>
                  <DropdownSeparator />
                  <DropdownItem
                    onClick={() =>
                      setAssigneeFilter(
                        assigneeFilter === '__unassigned__' ? null : '__unassigned__',
                      )
                    }
                    className={assigneeFilter === '__unassigned__' ? 'font-semibold' : ''}
                  >
                    Unassigned
                  </DropdownItem>
                  {sortedMembers.length > 0 && <DropdownSeparator />}
                  {sortedMembers.map((m) => (
                    <DropdownItem
                      key={m.id}
                      onClick={() => setAssigneeFilter(assigneeFilter === m.id ? null : m.id)}
                      className={assigneeFilter === m.id ? 'font-semibold' : ''}
                    >
                      {m.id === userId ? `${m.name || m.email} (you)` : m.name || m.email}
                    </DropdownItem>
                  ))}
                </FilterDropdown>
              </div>
            </div>
          </div>

          <div className="scrollbar-mieweb scrollbar-mieweb-visible min-h-0 flex-1 overflow-y-scroll">
            {/* Ticket rows */}
            {filteredTickets.length > 0 ? (
              <ul
                ref={ticketListRef}
                className="divide-y divide-neutral-100 dark:divide-neutral-800"
                aria-label={statusFilter === 'open' ? 'Open tickets' : 'Closed tickets'}
              >
                {filteredTickets.map((t) => (
                  <TicketRow
                    key={t.id}
                    ticket={t}
                    isCreator={t.createdBy === userId}
                    assigneeName={getAssigneeName(t.assignedTo)}
                    assigneeId={t.assignedTo}
                    createdByName={getAssigneeName(t.createdBy)}
                    suppressAvatars={
                      openFilterMenu !== 'team' &&
                      openFilterMenu !== 'status' &&
                      suppressedAvatarIds.includes(t.id)
                    }
                    onEditRequest={openEditModal}
                    onDeleteRequest={setDeleteId}
                    onChangeStatusRequest={(ticket) => {
                      setChangeStatusTicket(ticket);
                      setChangeStatusValue(ticket.status || 'open');
                    }}
                    onShareWithTimeharbor={async (ticket, shared) => {
                      try {
                        await shareTicketWithTimeharbor(ticket.id, shared);
                        // Optimistically update local state
                        setTickets((prev) =>
                          prev.map((t) =>
                            t.id === ticket.id ? { ...t, sharedWithTimeharbor: shared } : t,
                          ),
                        );
                      } catch {
                        // Silently ignore — user can retry
                      }
                    }}
                  />
                ))}
              </ul>
            ) : ticketsLoading ? (
              <TicketListSkeleton />
            ) : (
              <div className="px-4 py-10 text-center">
                <Text variant="muted" size="sm">
                  {searchQuery
                    ? 'No tickets match your search.'
                    : statusFilter === 'open'
                      ? 'No open tickets. Create one to get started!'
                      : 'No closed tickets.'}
                </Text>
              </div>
            )}
          </div>
        </Card>

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
              <Select
                label="Assignee"
                options={memberOptions}
                value={editAssignee}
                onValueChange={setEditAssignee}
              />
              <Select
                label="Priority"
                options={[{ value: '', label: 'No Priority' }, ...PRIORITY_OPTIONS]}
                value={editPriority}
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
                {detailsTicket.assignedTo && (
                  <div>
                    <Text size="xs" variant="muted" weight="medium">
                      Assigned To
                    </Text>
                    <Text size="sm">
                      {getAssigneeName(detailsTicket.assignedTo) ?? detailsTicket.assignedTo}
                    </Text>
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
              {userId && detailsTicket.assignedTo !== userId && (
                <Button
                  variant="secondary"
                  onClick={async () => {
                    await ticketApi.assignTicket(detailsTicket.id, userId);
                    setDetailsTicket((t) => (t ? { ...t, assignedTo: userId } : t));
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

        {/* Delete confirmation */}
        <Modal open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)} size="sm">
          <ModalHeader>
            <ModalTitle>Delete Ticket?</ModalTitle>
            <ModalClose />
          </ModalHeader>
          <ModalBody>
            <Text variant="muted" size="sm">
              This will permanently delete this ticket and remove it from all clock events.
            </Text>
          </ModalBody>
          <ModalFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete} isLoading={deleteLoading}>
              Delete
            </Button>
          </ModalFooter>
        </Modal>
      </div>
    </AppPage>
  );
};
