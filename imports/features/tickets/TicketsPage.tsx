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
  faExternalLink,
  faPause,
  faPen,
  faPlay,
  faPlus,
  faSearch,
  faTrash,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Meteor } from 'meteor/meteor';
import { useFind, useSubscribe } from 'meteor/react-meteor-data';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
} from '@mieweb/ui';
import React, { useCallback, useMemo, useState } from 'react';

import { useTeam } from '../../lib/TeamContext';
import { formatDuration } from '../../lib/timeUtils';
import { useMethod } from '../../lib/useMethod';
import { Tickets } from './api';
import type { TicketDoc } from './schema';

export const TicketsPage: React.FC = () => {
  const userId = Meteor.userId();
  const { teams, selectedTeamId, setSelectedTeamId, teamsReady, currentTime, activeClockEvent } = useTeam();

  const teamIds = useMemo(() => (selectedTeamId ? [selectedTeamId] : []), [selectedTeamId]);
  useSubscribe('teamTickets', teamIds);

  const allTickets = useFind(
    () => Tickets.find({ teamId: selectedTeamId ?? '__none__' }, { sort: { createdAt: -1 } }),
    [selectedTeamId],
  );

  // Methods
  const createTicketMethod = useMethod<[{ teamId: string; title: string; github?: string }], string>('tickets.create');
  const updateTicketMethod = useMethod<[{ ticketId: string; updates: Record<string, unknown> }]>('tickets.update');
  const deleteTicketMethod = useMethod<[string]>('tickets.delete');
  const startTicketMethod = useMethod<[{ ticketId: string; now: number }]>('tickets.start');
  const stopTicketMethod = useMethod<[{ ticketId: string; now: number }]>('tickets.stop');

  // UI state
  const [showCreate, setShowCreate] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createGithub, setCreateGithub] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editGithub, setEditGithub] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Filter tickets
  const filteredTickets = useMemo(() => {
    if (!searchQuery.trim()) return allTickets;
    const q = searchQuery.toLowerCase();
    return allTickets.filter(
      (t) => t.title.toLowerCase().includes(q) || t.github?.toLowerCase().includes(q),
    );
  }, [allTickets, searchQuery]);

  // My tickets vs others
  const myTickets = useMemo(() => filteredTickets.filter((t) => t.createdBy === userId), [filteredTickets, userId]);
  const otherTickets = useMemo(() => filteredTickets.filter((t) => t.createdBy !== userId), [filteredTickets, userId]);

  // ── Handlers ──

  const handleCreate = useCallback(async () => {
    if (!createTitle.trim() || !selectedTeamId) return;
    await createTicketMethod.call({
      teamId: selectedTeamId,
      title: createTitle.trim(),
      github: createGithub.trim() || undefined,
    });
    setCreateTitle('');
    setCreateGithub('');
    setShowCreate(false);
  }, [createTitle, createGithub, selectedTeamId, createTicketMethod]);

  const handleStartStop = useCallback(
    async (ticket: TicketDoc) => {
      const now = Date.now();
      if (ticket.startTimestamp) {
        await stopTicketMethod.call({ ticketId: ticket._id!, now });
      } else {
        await startTicketMethod.call({ ticketId: ticket._id!, now });
      }
    },
    [startTicketMethod, stopTicketMethod],
  );

  const handleSaveEdit = useCallback(async () => {
    if (!editingId || !editTitle.trim()) return;
    await updateTicketMethod.call({
      ticketId: editingId,
      updates: { title: editTitle.trim(), github: editGithub.trim() },
    });
    setEditingId(null);
  }, [editingId, editTitle, editGithub, updateTicketMethod]);

  const handleDelete = useCallback(async () => {
    if (!deleteId) return;
    await deleteTicketMethod.call(deleteId);
    setDeleteId(null);
  }, [deleteId, deleteTicketMethod]);

  const startEdit = (ticket: TicketDoc) => {
    setEditingId(ticket._id!);
    setEditTitle(ticket.title);
    setEditGithub(ticket.github || '');
  };

  // ── Ticket Row ──

  const TicketRow: React.FC<{ ticket: TicketDoc; canManage: boolean }> = ({ ticket, canManage }) => {
    const isRunning = !!ticket.startTimestamp;
    const elapsed = isRunning
      ? (ticket.accumulatedTime || 0) + Math.floor((currentTime - ticket.startTimestamp!) / 1000)
      : ticket.accumulatedTime || 0;

    const isEditing = editingId === ticket._id;

    return (
      <li className="flex items-center gap-3 px-5 py-3">
        {/* Play/Pause */}
        {canManage && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleStartStop(ticket)}
            className={`rounded-full ${
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
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <div className="flex flex-col gap-2">
              <Input
                label="Title"
                hideLabel
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                size="sm"
                autoFocus
              />
              <Input
                label="GitHub URL"
                hideLabel
                type="url"
                value={editGithub}
                onChange={(e) => setEditGithub(e.target.value)}
                placeholder="GitHub URL (optional)"
                size="sm"
              />
              <div className="flex gap-2">
                <Button variant="primary" size="sm" onClick={handleSaveEdit}>Save</Button>
                <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <>
              <Text size="sm" weight="medium" truncate>{ticket.title}</Text>
              <div className="flex items-center gap-2">
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
                {ticket.status && ticket.status !== 'open' && (
                  <Badge
                    variant={ticket.status === 'reviewed' ? 'success' : 'secondary'}
                    size="sm"
                  >
                    {ticket.status}
                  </Badge>
                )}
              </div>
            </>
          )}
        </div>

        {/* Time */}
        <Badge variant={isRunning ? 'success' : 'secondary'} size="sm" className="font-mono">
          {formatDuration(elapsed)}
        </Badge>

        {/* Actions */}
        {canManage && !isEditing && (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => startEdit(ticket)}
              aria-label="Edit"
            >
              <FontAwesomeIcon icon={faPen} className="text-xs" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDeleteId(ticket._id!)}
              className="text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
              aria-label="Delete"
            >
              <FontAwesomeIcon icon={faTrash} className="text-xs" />
            </Button>
          </div>
        )}
      </li>
    );
  };

  const teamOptions = useMemo(
    () =>
      teams.map((t) => ({
        value: t._id!,
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
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          leftIcon={<FontAwesomeIcon icon={faPlus} />}
          onClick={() => setShowCreate(true)}
        >
          New Ticket
        </Button>

        {/* Search */}
        <div className="relative flex-1">
          <FontAwesomeIcon icon={faSearch} className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-neutral-400" />
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

        {/* Team switcher */}
        {teams.length > 1 && (
          <Select
            label="Team"
            hideLabel
            size="sm"
            options={teamOptions}
            value={selectedTeamId ?? ''}
            onValueChange={setSelectedTeamId}
          />
        )}
      </div>

      {/* Create ticket form */}
      {showCreate && (
        <Card variant="outlined" padding="md" className="border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20">
          <CardContent>
            <div className="flex items-center justify-between">
              <Text size="sm" weight="semibold">New Ticket</Text>
              <Button variant="ghost" size="icon" onClick={() => setShowCreate(false)} aria-label="Close">
                <FontAwesomeIcon icon={faXmark} />
              </Button>
            </div>
            <div className="mt-3 space-y-2">
              <Input
                label="Title"
                hideLabel
                placeholder="Ticket title"
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                autoFocus
              />
              <Input
                label="GitHub URL"
                hideLabel
                type="url"
                placeholder="GitHub URL (optional)"
                value={createGithub}
                onChange={(e) => setCreateGithub(e.target.value)}
              />
              <Button
                variant="primary"
                onClick={handleCreate}
                isLoading={createTicketMethod.loading}
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
        <Card padding="none">
          <CardHeader className="px-5 py-3">
            <CardTitle className="text-sm">My Tickets ({myTickets.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {myTickets.map((t) => (
                <TicketRow key={t._id} ticket={t} canManage={true} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Other tickets */}
      {otherTickets.length > 0 && (
        <Card padding="none">
          <CardHeader className="px-5 py-3">
            <CardTitle className="text-sm">Team Tickets ({otherTickets.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {otherTickets.map((t) => (
                <TicketRow key={t._id} ticket={t} canManage={false} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {filteredTickets.length === 0 && (
        <Card variant="outlined" padding="lg" className="border-dashed text-center">
          <CardContent>
            <Text variant="muted" size="sm">
              {searchQuery ? 'No tickets match your search.' : 'No tickets yet. Create one to get started!'}
            </Text>
          </CardContent>
        </Card>
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
          <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
          <Button
            variant="danger"
            onClick={handleDelete}
            isLoading={deleteTicketMethod.loading}
          >
            Delete
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
};
