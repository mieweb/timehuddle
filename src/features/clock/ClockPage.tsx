/**
 * ClockPage — Clock in/out with live session timer.
 *
 * Features:
 *   • Big clock in/out button with live session timer
 *   • Team selector
 *   • Media attachments (links) on clock entries
 *   • Create new tickets from here
 *
 * Ticket-level timer management has moved to the Timers page (/app/timers).
 */
import { faCircleStop, faPlus, faStopwatch, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Spinner, Text } from '@mieweb/ui';
import React, { useCallback, useState } from 'react';

import { useTeam } from '../../lib/TeamContext';
import { formatTimer } from '../../lib/timeUtils';
import { ticketApi } from '../../lib/api';
import { AppPage } from '../../ui/AppPage';
import { useClockToggle } from '../../lib/useClockToggle';
import { useSession } from '../../lib/useSession';
import { AttachmentsPanel } from './AttachmentsPanel';

// ─── ClockPage ────────────────────────────────────────────────────────────────

export const ClockPage: React.FC = () => {
  const { selectedTeamId, activeClockEvent, currentTime, teamsReady } = useTeam();

  const { clockIn, clockOut, clockInLoading, clockOutLoading } = useClockToggle();
  const { user } = useSession();

  // Loading states
  const [createTicketLoading, setCreateTicketLoading] = useState(false);

  // UI state
  const [showNewTicket, setShowNewTicket] = useState(false);
  const [newTicketTitle, setNewTicketTitle] = useState('');

  // Session duration
  const sessionSeconds = activeClockEvent
    ? Math.floor((currentTime - activeClockEvent.startTime) / 1000)
    : 0;

  // ── Handlers ──

  const handleCreateTicket = useCallback(async () => {
    if (!newTicketTitle.trim() || !selectedTeamId) return;
    setCreateTicketLoading(true);
    try {
      await ticketApi.createTicket({ teamId: selectedTeamId, title: newTicketTitle.trim() });
      setNewTicketTitle('');
      setShowNewTicket(false);
    } finally {
      setCreateTicketLoading(false);
    }
  }, [newTicketTitle, selectedTeamId]);

  if (!teamsReady) {
    return (
      <div className="flex items-center justify-center p-12">
        <Spinner size="lg" label="Loading…" />
      </div>
    );
  }

  return (
    <AppPage>
      {/* ── Clock Button ── */}
      <Card padding="lg" className="flex flex-col items-center gap-4 rounded-2xl">
        <CardContent className="flex flex-col items-center gap-4">
          {activeClockEvent ? (
            <>
              <div className="text-center">
                <Text
                  variant="success"
                  size="xs"
                  weight="medium"
                  className="uppercase tracking-widest"
                >
                  Session Active
                </Text>
                <Text size="3xl" weight="bold" className="mt-2 font-mono">
                  {formatTimer(sessionSeconds)}
                </Text>
              </div>
              {/* Clock Out — keeping custom round button for the unique clock UI */}
              <button
                type="button"
                onClick={clockOut}
                disabled={clockOutLoading}
                className="flex h-24 w-24 items-center justify-center rounded-full bg-red-500 text-white shadow-lg transition-transform hover:scale-105 hover:bg-red-600 active:scale-95 disabled:opacity-50"
                aria-label="Clock out"
              >
                <FontAwesomeIcon icon={faCircleStop} className="text-3xl" />
              </button>
              <Text variant="muted" size="xs">
                Tap to clock out
              </Text>
            </>
          ) : (
            <>
              <Text variant="muted" size="xs" weight="medium" className="uppercase tracking-widest">
                Ready to work
              </Text>
              {/* Clock In — keeping custom round button for the unique clock UI */}
              <button
                type="button"
                onClick={clockIn}
                disabled={clockInLoading || !selectedTeamId}
                className="flex h-24 w-24 items-center justify-center rounded-full bg-green-500 text-white shadow-lg transition-transform hover:scale-105 hover:bg-green-600 active:scale-95 disabled:opacity-50"
                aria-label="Clock in"
              >
                <FontAwesomeIcon icon={faStopwatch} className="text-3xl" />
              </button>
              <Text variant="muted" size="xs">
                Tap to clock in
              </Text>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Quick Ticket Creation ── */}
      {activeClockEvent && (
        <Card padding="none">
          <CardHeader className="flex flex-row items-center justify-between px-5 py-3">
            <CardTitle className="text-sm">Quick Actions</CardTitle>
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
                isLoading={createTicketLoading}
              >
                Add
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setShowNewTicket(false);
                  setNewTicketTitle('');
                }}
                aria-label="Cancel"
              >
                <FontAwesomeIcon icon={faXmark} />
              </Button>
            </div>
          )}

          {!showNewTicket && (
            <div className="px-5 py-4 text-center">
              <Text variant="muted" size="xs">
                Track time on tickets in the{' '}
                <a href="/app/timers" className="text-blue-500 hover:underline">
                  Timers
                </a>{' '}
                page.
              </Text>
            </div>
          )}
        </Card>
      )}

      {/* ── Attachments for the active clock entry ── */}
      {activeClockEvent && (
        <Card padding="md">
          <AttachmentsPanel kind="clock" entityId={activeClockEvent.id} currentUserId={user?.id} />
        </Card>
      )}
    </AppPage>
  );
};
