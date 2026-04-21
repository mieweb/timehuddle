/**
 * ClockPage — Clock in/out with live timer and ticket management.
 *
 * Features:
 *   • Big clock in/out button with live session timer
 *   • Team selector
 *   • Active session ticket list with start/stop toggles
 *   • YouTube showcase link (prompted on clock out)
 *   • Add existing ticket or create new ticket from here
 */
import {
  faCircleStop,
  faPlay,
  faPause,
  faPlus,
  faStopwatch,
  faVideo,
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
import { formatTimer, formatDuration } from '../../lib/timeUtils';
import { useMethod } from '../../lib/useMethod';
import { Tickets } from '../tickets/api';

// ─── ClockPage ────────────────────────────────────────────────────────────────

export const ClockPage: React.FC = () => {
  const userId = Meteor.userId();
  const {
    teams,
    selectedTeamId,
    setSelectedTeamId,
    activeClockEvent,
    currentTime,
    teamsReady,
  } = useTeam();

  // Subscribe to tickets for the selected team
  const teamIds = useMemo(() => (selectedTeamId ? [selectedTeamId] : []), [selectedTeamId]);
  useSubscribe('teamTickets', teamIds);

  const allTickets = useFind(
    () => Tickets.find({ teamId: selectedTeamId ?? '__none__' }),
    [selectedTeamId],
  );

  // Methods
  const clockStart = useMethod<[{ teamId: string }], string>('clock.start');
  const clockStop = useMethod<[{ teamId: string; youtubeShortLink?: string }]>('clock.stop');
  const addTicketToEvent = useMethod<[{ clockEventId: string; ticketId: string; now: number }]>('clock.addTicket');
  const stopTicketInEvent = useMethod<[{ clockEventId: string; ticketId: string; now: number }]>('clock.stopTicket');
  const createTicket = useMethod<[{ teamId: string; title: string }], string>('tickets.create');

  // UI state
  const [showYoutubeModal, setShowYoutubeModal] = useState(false);
  const [youtubeLink, setYoutubeLink] = useState('');
  const [showNewTicket, setShowNewTicket] = useState(false);
  const [newTicketTitle, setNewTicketTitle] = useState('');

  // Session duration
  const sessionSeconds = activeClockEvent
    ? Math.floor((currentTime - activeClockEvent.startTimestamp) / 1000)
    : 0;

  // ── Handlers ──

  const handleClockIn = useCallback(async () => {
    if (!selectedTeamId) return;
    await clockStart.call({ teamId: selectedTeamId });
  }, [selectedTeamId, clockStart]);

  const handleClockOut = useCallback(() => {
    setShowYoutubeModal(true);
  }, []);

  const confirmClockOut = useCallback(async () => {
    if (!selectedTeamId) return;
    const link = youtubeLink.trim();
    await clockStop.call({ teamId: selectedTeamId, youtubeShortLink: link || undefined });
    setShowYoutubeModal(false);
    setYoutubeLink('');
  }, [selectedTeamId, clockStop, youtubeLink]);

  const handleStartTicket = useCallback(
    async (ticketId: string) => {
      if (!activeClockEvent?._id) return;
      await addTicketToEvent.call({ clockEventId: activeClockEvent._id, ticketId, now: Date.now() });
    },
    [activeClockEvent, addTicketToEvent],
  );

  const handleStopTicket = useCallback(
    async (ticketId: string) => {
      if (!activeClockEvent?._id) return;
      await stopTicketInEvent.call({ clockEventId: activeClockEvent._id, ticketId, now: Date.now() });
    },
    [activeClockEvent, stopTicketInEvent],
  );

  const handleCreateTicket = useCallback(async () => {
    if (!newTicketTitle.trim() || !selectedTeamId) return;
    await createTicket.call({ teamId: selectedTeamId, title: newTicketTitle.trim() });
    setNewTicketTitle('');
    setShowNewTicket(false);
  }, [newTicketTitle, selectedTeamId, createTicket]);

  // Tickets in the active clock event
  const activeTicketIds = useMemo(
    () => new Set(activeClockEvent?.tickets.map((t) => t.ticketId) ?? []),
    [activeClockEvent],
  );

  // Available tickets not yet in the session
  const availableTickets = useMemo(
    () => allTickets.filter((t) => !activeTicketIds.has(t._id!) && t.createdBy === userId),
    [allTickets, activeTicketIds, userId],
  );

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
    <div className="mx-auto max-w-2xl space-y-6 p-4 md:p-6">
      {/* Team selector */}
      {teams.length > 1 && (
        <Select
          label="Team"
          hideLabel={false}
          size="sm"
          options={teamOptions}
          value={selectedTeamId ?? ''}
          onValueChange={setSelectedTeamId}
        />
      )}

      {/* ── Clock Button ── */}
      <Card padding="lg" className="flex flex-col items-center gap-4 rounded-2xl">
        <CardContent className="flex flex-col items-center gap-4">
          {activeClockEvent ? (
            <>
              <div className="text-center">
                <Text variant="success" size="xs" weight="medium" className="uppercase tracking-widest">
                  Session Active
                </Text>
                <Text size="3xl" weight="bold" className="mt-2 font-mono">
                  {formatTimer(sessionSeconds)}
                </Text>
              </div>
              {/* Clock Out — keeping custom round button for the unique clock UI */}
              <button
                type="button"
                onClick={handleClockOut}
                disabled={clockStop.loading}
                className="flex h-24 w-24 items-center justify-center rounded-full bg-red-500 text-white shadow-lg transition-transform hover:scale-105 hover:bg-red-600 active:scale-95 disabled:opacity-50"
                aria-label="Clock out"
              >
                <FontAwesomeIcon icon={faCircleStop} className="text-3xl" />
              </button>
              <Text variant="muted" size="xs">Tap to clock out</Text>
            </>
          ) : (
            <>
              <Text variant="muted" size="xs" weight="medium" className="uppercase tracking-widest">
                Ready to work
              </Text>
              {/* Clock In — keeping custom round button for the unique clock UI */}
              <button
                type="button"
                onClick={handleClockIn}
                disabled={clockStart.loading || !selectedTeamId}
                className="flex h-24 w-24 items-center justify-center rounded-full bg-green-500 text-white shadow-lg transition-transform hover:scale-105 hover:bg-green-600 active:scale-95 disabled:opacity-50"
                aria-label="Clock in"
              >
                <FontAwesomeIcon icon={faStopwatch} className="text-3xl" />
              </button>
              <Text variant="muted" size="xs">Tap to clock in</Text>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Session Tickets ── */}
      {activeClockEvent && (
        <Card padding="none">
          <CardHeader className="flex flex-row items-center justify-between px-5 py-3">
            <CardTitle className="text-sm">Session Tickets</CardTitle>
            <Button variant="link" size="sm" onClick={() => setShowNewTicket(true)}>
              <FontAwesomeIcon icon={faPlus} className="mr-1" />
              New Ticket
            </Button>
          </CardHeader>

          {/* New ticket form */}
          {showNewTicket && (
            <div className="flex gap-2 border-b border-neutral-100 px-5 py-3 dark:border-neutral-800">
              <Input
                label="Ticket title"
                hideLabel
                placeholder="Ticket title"
                value={newTicketTitle}
                onChange={(e) => setNewTicketTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateTicket()}
                size="sm"
                className="flex-1"
                autoFocus
              />
              <Button
                variant="primary"
                size="sm"
                onClick={handleCreateTicket}
                isLoading={createTicket.loading}
              >
                Add
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => { setShowNewTicket(false); setNewTicketTitle(''); }}
                aria-label="Cancel"
              >
                <FontAwesomeIcon icon={faXmark} />
              </Button>
            </div>
          )}

          {/* Active tickets */}
          <CardContent className="p-0">
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {activeClockEvent.tickets.map((ct) => {
                const ticket = allTickets.find((t) => t._id === ct.ticketId);
                const isRunning = !!ct.startTimestamp;
                const elapsed = isRunning
                  ? ct.accumulatedTime + Math.floor((currentTime - ct.startTimestamp!) / 1000)
                  : ct.accumulatedTime;

                return (
                  <li key={ct.ticketId} className="flex items-center gap-3 px-5 py-3">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => (isRunning ? handleStopTicket(ct.ticketId) : handleStartTicket(ct.ticketId))}
                      className={
                        isRunning
                          ? 'rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400'
                          : 'rounded-full bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400'
                      }
                      aria-label={isRunning ? 'Pause ticket' : 'Start ticket'}
                    >
                      <FontAwesomeIcon icon={isRunning ? faPause : faPlay} className="text-xs" />
                    </Button>
                    <div className="min-w-0 flex-1">
                      <Text size="sm" weight="medium" truncate>
                        {ticket?.title ?? ct.ticketId}
                      </Text>
                      {ticket?.github && (
                        <a
                          href={ticket.github}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-500 hover:underline"
                        >
                          {ticket.github.includes('github.com') ? 'GitHub' : 'Link'} ↗
                        </a>
                      )}
                    </div>
                    <Badge variant={isRunning ? 'success' : 'secondary'} size="sm" className="font-mono">
                      {formatDuration(elapsed)}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          </CardContent>

          {/* Add existing ticket */}
          {availableTickets.length > 0 && (
            <div className="border-t border-neutral-100 px-5 py-3 dark:border-neutral-800">
              <Text variant="muted" size="xs" className="mb-2">Add existing ticket:</Text>
              <div className="flex flex-wrap gap-2">
                {availableTickets.slice(0, 5).map((t) => (
                  <Button
                    key={t._id}
                    variant="outline"
                    size="sm"
                    onClick={() => handleStartTicket(t._id!)}
                  >
                    {t.title}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {activeClockEvent.tickets.length === 0 && !showNewTicket && (
            <div className="px-5 py-6 text-center">
              <Text variant="muted" size="xs">
                No tickets in this session. Add one to track your work!
              </Text>
            </div>
          )}
        </Card>
      )}

      {/* ── YouTube Modal ── */}
      <Modal open={showYoutubeModal} onOpenChange={(open) => !open && confirmClockOut()} size="md">
        <ModalHeader>
          <ModalTitle>
            <FontAwesomeIcon icon={faVideo} className="mr-2 text-red-500" />
            YouTube Showcase Link
          </ModalTitle>
          <ModalClose />
        </ModalHeader>
        <ModalBody>
          <Text variant="muted" size="sm" className="mb-3">
            Optionally add a YouTube link to showcase your work during this session.
          </Text>
          <Input
            label="YouTube URL"
            hideLabel
            type="url"
            placeholder="https://youtube.com/shorts/..."
            value={youtubeLink}
            onChange={(e) => setYoutubeLink(e.target.value)}
            autoFocus
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onClick={confirmClockOut}>Skip</Button>
          <Button variant="danger" onClick={confirmClockOut} isLoading={clockStop.loading}>
            Clock Out
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
};
