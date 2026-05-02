/**
 * TicketsPage — CRUD ticket management with time tracking.
 *
 * Features:
 *   • Create ticket (title + optional GitHub URL)
 *   • Start/stop timer per ticket
 *   • Edit title/GitHub link
 *   • Delete tickets
 *   • Search/filter
 *   • Accumulated time display
 */
import {
  faEllipsisVertical,
  faExternalLink,
  faEye,
  faPause,
  faPen,
  faPlay,
  faPlus,
  faRightLeft,
  faSearch,
  faTrash,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
} from '@mieweb/ui';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { teamApi, ticketApi, type TeamMember, type Ticket } from '../../lib/api';
import { useTeam } from '../../lib/TeamContext';
import { formatDuration } from '../../lib/timeUtils';
import { useSession } from '../../lib/useSession';

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

function priorityDotColor(p: string | null): string {
  if (p === 'critical') return 'bg-red-500';
  if (p === 'high') return 'bg-amber-500';
  if (p === 'medium') return 'bg-blue-500';
  if (p === 'low') return 'bg-neutral-400';
  return '';
}

async function fetchIssueTitle(url: string): Promise<string | null> {
  // GitHub: https://github.com/{owner}/{repo}/issues/{n} or /pull/{n}
  const githubMatch = url.match(/github\.com\/([^/?#]+)\/([^/?#]+)\/(issues|pull)\/(\d+)/);
  if (githubMatch) {
    const [, owner, repo, , number] = githubMatch;
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}`, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { title?: string };
      return data.title ?? null;
    } catch {
      return null;
    }
  }
  // Redmine: https://{host}/issues/{n}
  const redmineMatch = url.match(/^(https?:\/\/[^/]+)\/issues\/(\d+)/);
  if (redmineMatch) {
    const [, base, number] = redmineMatch;
    try {
      const res = await fetch(`${base}/issues/${number}.json`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { issue?: { subject?: string } };
      return data.issue?.subject ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

// ─── TicketRow ─────────────────────────────────────────────────────────────────

interface TicketRowProps {
  ticket: Ticket;
  isCreator: boolean;
  currentTime: number;
  assigneeName: string | null;
  onStartStop: (ticket: Ticket) => Promise<void>;
  onEditRequest: (ticket: Ticket) => void;
  onDeleteRequest: (id: string) => void;
  onChangeStatusRequest: (ticket: Ticket) => void;
  onDetailsRequest: (ticket: Ticket) => void;
}

const TicketRow: React.FC<TicketRowProps> = ({
  ticket,
  isCreator,
  currentTime,
  assigneeName,
  onStartStop,
  onEditRequest,
  onDeleteRequest,
  onChangeStatusRequest,
  onDetailsRequest,
}) => {
  const isRunning = !!ticket.startTimestamp;
  const elapsed = isRunning
    ? (ticket.accumulatedTime || 0) + Math.floor((currentTime - ticket.startTimestamp!) / 1000)
    : ticket.accumulatedTime || 0;

  const statusLabel =
    STATUS_OPTIONS.find((s) => s.value === ticket.status)?.label ?? ticket.status ?? 'Open';
  const dotColor = priorityDotColor(ticket.priority);

  return (
    <li className="px-5 py-3">
      <div className="flex items-start gap-3">
        {/* Play/Pause — creator only */}
        {isCreator && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onStartStop(ticket)}
            className={`shrink-0 rounded-full ${
              isRunning
                ? 'bg-amber-100 text-amber-600 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-400'
                : 'bg-green-100 text-green-600 hover:bg-green-200 dark:bg-green-900/40 dark:text-green-400'
            }`}
            aria-label={isRunning ? 'Pause ticket' : 'Start ticket'}
          >
            <FontAwesomeIcon icon={isRunning ? faPause : faPlay} className="text-xs" />
          </Button>
        )}

        {/* Content */}
        <div className="min-w-0 flex-1 space-y-1">
          {/* Title row: priority dot + title + 3-dot menu */}
          <div className="flex items-start gap-1.5">
            {dotColor && (
              <span
                className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${dotColor}`}
                aria-label={`Priority: ${ticket.priority}`}
              />
            )}
            <Text size="sm" weight="medium" className="flex-1">
              {ticket.title}
            </Text>
            <Dropdown
              trigger={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Ticket options"
                  className="-mt-1 -mr-2 shrink-0"
                >
                  <FontAwesomeIcon icon={faEllipsisVertical} className="text-sm" />
                </Button>
              }
              placement="bottom-end"
            >
              <DropdownContent>
                <DropdownItem
                  icon={<FontAwesomeIcon icon={faEye} />}
                  onClick={() => onDetailsRequest(ticket)}
                >
                  Ticket Details
                </DropdownItem>
                {isCreator && (
                  <DropdownItem
                    icon={<FontAwesomeIcon icon={faPen} />}
                    onClick={() => onEditRequest(ticket)}
                  >
                    Edit Ticket
                  </DropdownItem>
                )}
                <DropdownItem
                  icon={<FontAwesomeIcon icon={faRightLeft} />}
                  onClick={() => onChangeStatusRequest(ticket)}
                >
                  Change Status
                </DropdownItem>
                {isCreator && (
                  <>
                    <DropdownSeparator />
                    <DropdownItem
                      icon={<FontAwesomeIcon icon={faTrash} />}
                      variant="danger"
                      onClick={() => onDeleteRequest(ticket.id)}
                    >
                      Delete Ticket
                    </DropdownItem>
                  </>
                )}
              </DropdownContent>
            </Dropdown>
          </div>

          {ticket.description && (
            <p className="line-clamp-2 text-xs text-neutral-500 dark:text-neutral-400">
              {ticket.description}
            </p>
          )}

          {/* Footer: github, assignee, time, status */}
          <div className="flex flex-wrap items-center gap-2">
            {ticket.github && (
              <a
                href={ticket.github}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-blue-500 hover:underline"
              >
                <FontAwesomeIcon icon={faExternalLink} className="text-[10px]" />
                {ticket.github.includes('github.com') ? 'GitHub' : 'Link'}
              </a>
            )}
            {assigneeName && (
              <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                {assigneeName}
              </span>
            )}
            <Badge variant={isRunning ? 'success' : 'secondary'} size="sm" className="font-mono">
              {formatDuration(elapsed)}
            </Badge>
            <Badge variant="secondary" size="sm">
              {statusLabel}
            </Badge>
          </div>
        </div>
      </div>
    </li>
  );
};

export const TicketsPage: React.FC = () => {
  const { user } = useSession();
  const userId = user?.id ?? null;
  const { teams, selectedTeamId, setSelectedTeamId, teamsReady, currentTime } = useTeam();

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

  const refetch = useCallback(async () => {
    if (!selectedTeamId) {
      setTickets([]);
      return;
    }
    try {
      const data = await ticketApi.getTickets(selectedTeamId);
      setTickets(data);
    } catch {
      // keep previous tickets on error
    }
  }, [selectedTeamId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Fetch team members for assignee display + edit modal
  useEffect(() => {
    if (!selectedTeamId) {
      setTeamMembers([]);
      return;
    }
    teamApi
      .getMembers(selectedTeamId)
      .then(setTeamMembers)
      .catch(() => {});
  }, [selectedTeamId]);

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
  const [showSearch, setShowSearch] = useState(false);

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

  // Status filter
  type StatusFilter = 'all' | 'open' | 'inprogress' | 'done';
  const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'open', label: 'Open' },
    { value: 'inprogress', label: 'In Progress' },
    { value: 'done', label: 'Done' },
  ];
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Filter tickets by search
  const searchFilteredTickets = useMemo(() => {
    if (!searchQuery.trim()) return tickets;
    const q = searchQuery.toLowerCase();
    return tickets.filter(
      (t) => t.title.toLowerCase().includes(q) || t.github?.toLowerCase().includes(q),
    );
  }, [tickets, searchQuery]);

  // Filter tickets by status tab
  const filteredTickets = useMemo(() => {
    if (statusFilter === 'all') return searchFilteredTickets;
    if (statusFilter === 'open')
      return searchFilteredTickets.filter((t) => !t.status || t.status === 'open');
    if (statusFilter === 'inprogress')
      return searchFilteredTickets.filter((t) => t.status === 'in-progress' || !!t.startTimestamp);
    if (statusFilter === 'done')
      return searchFilteredTickets.filter((t) => t.status === 'closed' || t.status === 'reviewed');
    return searchFilteredTickets;
  }, [searchFilteredTickets, statusFilter]);

  // My tickets vs others
  const myTickets = useMemo(
    () => filteredTickets.filter((t) => t.createdBy === userId),
    [filteredTickets, userId],
  );
  const otherTickets = useMemo(
    () => filteredTickets.filter((t) => t.createdBy !== userId),
    [filteredTickets, userId],
  );

  // Assignee name resolver
  const getAssigneeName = useCallback(
    (assignedTo: string | null) => {
      if (!assignedTo) return null;
      const member = teamMembers.find((m) => m.id === assignedTo);
      return member ? member.name || member.email : null;
    },
    [teamMembers],
  );

  // Member options for assignee select
  const memberOptions = useMemo(
    () => [
      { value: '', label: 'Unassigned' },
      ...teamMembers.map((m) => ({ value: m.id, label: m.name || m.email })),
    ],
    [teamMembers],
  );

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

  const handleStartStop = useCallback(
    async (ticket: Ticket) => {
      const now = Date.now();
      if (ticket.startTimestamp) {
        await ticketApi.stopTimer(ticket.id, now);
      } else {
        await ticketApi.startTimer(ticket.id, now);
      }
      void refetch();
    },
    [refetch],
  );

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

  const teamOptions = useMemo(
    () =>
      teams.map((t) => ({
        value: t.id,
        label: t.isPersonal ? 'Personal' : t.name,
      })),
    [teams],
  );

  if (!teamsReady) {
    return (
      <div className="flex items-center justify-center p-12">
        <Spinner size="lg" label="Loading…" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      {/* ── Status filter tabs ── */}
      <div className="flex gap-1" role="tablist" aria-label="Filter tickets by status">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            role="tab"
            aria-selected={statusFilter === f.value}
            onClick={() => setStatusFilter(f.value)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              statusFilter === f.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ── Mobile header ── */}
      <div className="flex items-center gap-2 md:hidden">
        <Button
          variant="primary"
          size="icon"
          onClick={() => setShowCreate(true)}
          aria-label="New Ticket"
        >
          <FontAwesomeIcon icon={faPlus} />
        </Button>

        {teams.length > 1 && (
          <Select
            label="Team"
            hideLabel
            options={teamOptions}
            value={selectedTeamId ?? ''}
            onValueChange={setSelectedTeamId}
            className="flex-1"
          />
        )}

        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            setShowSearch((v) => !v);
            if (showSearch) setSearchQuery('');
          }}
          aria-label={showSearch ? 'Close search' : 'Search tickets'}
        >
          <FontAwesomeIcon icon={showSearch ? faXmark : faSearch} />
        </Button>
      </div>

      {/* Search input (mobile) */}
      {showSearch && (
        <div className="relative md:hidden">
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
            className="pl-8"
            size="sm"
            autoFocus
          />
        </div>
      )}

      {/* ── Desktop header ── */}
      <div className="hidden flex-wrap items-center gap-3 md:flex">
        <Button
          variant="primary"
          leftIcon={<FontAwesomeIcon icon={faPlus} />}
          onClick={() => setShowCreate(true)}
        >
          New Ticket
        </Button>

        <div className="relative flex-1">
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
            className="pl-8"
            size="sm"
          />
        </div>

        {teams.length > 1 && (
          <Select
            label="Team"
            hideLabel
            options={teamOptions}
            value={selectedTeamId ?? ''}
            onValueChange={setSelectedTeamId}
          />
        )}
      </div>

      {/* Create ticket form */}
      {showCreate && (
        <Card
          variant="outlined"
          padding="md"
          className="border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20"
        >
          <CardContent>
            <div className="flex items-center justify-between">
              <Text size="sm" weight="semibold">
                New Ticket
              </Text>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowCreate(false)}
                aria-label="Close"
              >
                <FontAwesomeIcon icon={faXmark} />
              </Button>
            </div>
            <div className="mt-3 space-y-2">
              <Input
                label="Title"
                hideLabel
                placeholder={createTitleFetching ? 'Fetching title…' : 'Ticket title'}
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                autoFocus
                disabled={createTitleFetching}
                onPaste={(e) => {
                  const text = (e.clipboardData ?? (e.nativeEvent as ClipboardEvent).clipboardData)
                    ?.getData('text')
                    ?.trim();
                  if (!text) return;
                  const isUrl =
                    /github\.com\/[^/]+\/[^/]+\/(issues|pull)\/\d+/.test(text) ||
                    /https?:\/\/.+\/issues\/\d+/.test(text);
                  if (!isUrl) return;
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
                label="GitHub / Redmine URL"
                hideLabel
                type="url"
                placeholder="GitHub / Redmine URL (optional)"
                value={createGithub}
                onChange={(e) => {
                  const url = e.target.value;
                  setCreateGithub(url);
                  if (createFetchTimer.current) clearTimeout(createFetchTimer.current);
                  if (
                    /github\.com\/[^/]+\/[^/]+\/(issues|pull)\/\d+/.test(url) ||
                    /https?:\/\/.+\/issues\/\d+/.test(url)
                  ) {
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
                onClick={handleCreate}
                isLoading={createLoading}
                loadingText="Creating…"
                disabled={!createTitle.trim()}
              >
                Create Ticket
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* My tickets */}
      {myTickets.length > 0 && (
        <Card padding="none" style={{ overflow: 'visible' }}>
          <CardHeader className="px-5 py-3">
            <CardTitle className="text-sm">My Tickets ({myTickets.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0" style={{ overflow: 'visible' }}>
            <ul
              className="divide-y divide-neutral-100 dark:divide-neutral-800"
              style={{ overflow: 'visible' }}
            >
              {myTickets.map((t) => (
                <TicketRow
                  key={t.id}
                  ticket={t}
                  isCreator={true}
                  currentTime={currentTime}
                  assigneeName={getAssigneeName(t.assignedTo)}
                  onStartStop={handleStartStop}
                  onEditRequest={openEditModal}
                  onDeleteRequest={setDeleteId}
                  onChangeStatusRequest={(ticket) => {
                    setChangeStatusTicket(ticket);
                    setChangeStatusValue(ticket.status || 'open');
                  }}
                  onDetailsRequest={setDetailsTicket}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Team tickets */}
      {otherTickets.length > 0 && (
        <Card padding="none" style={{ overflow: 'visible' }}>
          <CardHeader className="px-5 py-3">
            <CardTitle className="text-sm">Team Tickets ({otherTickets.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0" style={{ overflow: 'visible' }}>
            <ul
              className="divide-y divide-neutral-100 dark:divide-neutral-800"
              style={{ overflow: 'visible' }}
            >
              {otherTickets.map((t) => (
                <TicketRow
                  key={t.id}
                  ticket={t}
                  isCreator={false}
                  currentTime={currentTime}
                  assigneeName={getAssigneeName(t.assignedTo)}
                  onStartStop={handleStartStop}
                  onEditRequest={openEditModal}
                  onDeleteRequest={setDeleteId}
                  onChangeStatusRequest={(ticket) => {
                    setChangeStatusTicket(ticket);
                    setChangeStatusValue(ticket.status || 'open');
                  }}
                  onDetailsRequest={setDetailsTicket}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {filteredTickets.length === 0 && (
        <Card variant="outlined" padding="lg" className="border-dashed text-center">
          <CardContent>
            <Text variant="muted" size="sm">
              {searchQuery
                ? 'No tickets match your search.'
                : 'No tickets yet. Create one to get started!'}
            </Text>
          </CardContent>
        </Card>
      )}

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
              autoFocus
              disabled={titleFetching}
              onPaste={(e) => {
                const text = (e.clipboardData ?? (e.nativeEvent as ClipboardEvent).clipboardData)
                  ?.getData('text')
                  ?.trim();
                if (!text) return;
                const isUrl =
                  /github\.com\/[^/]+\/[^/]+\/(issues|pull)\/\d+/.test(text) ||
                  /https?:\/\/.+\/issues\/\d+/.test(text);
                if (!isUrl) return;
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
              autoResize
              rows={3}
            />
            <Input
              label="GitHub / Redmine URL"
              type="url"
              placeholder="https://github.com/…"
              value={editGithub}
              onChange={(e) => {
                const url = e.target.value;
                setEditGithub(url);
                if (editFetchTimer.current) clearTimeout(editFetchTimer.current);
                if (
                  /github\.com\/[^/]+\/[^/]+\/(issues|pull)\/\d+/.test(url) ||
                  /https?:\/\/.+\/issues\/\d+/.test(url)
                ) {
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
            Save Changes
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
                        className={`inline-block h-2 w-2 rounded-full ${priorityDotColor(detailsTicket.priority)}`}
                      />
                      <Text size="sm">
                        {detailsTicket.priority.charAt(0).toUpperCase() +
                          detailsTicket.priority.slice(1)}
                      </Text>
                    </div>
                  </div>
                )}
                <div>
                  <Text size="xs" variant="muted" weight="medium">
                    Time Tracked
                  </Text>
                  <Text size="sm" className="font-mono">
                    {formatDuration(detailsTicket.accumulatedTime || 0)}
                  </Text>
                </div>
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
            </div>
          </ModalBody>
          <ModalFooter>
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
  );
};
