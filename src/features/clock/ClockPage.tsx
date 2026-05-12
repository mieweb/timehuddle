/**
 * ClockPage — Clock in/out with live session timer.
 *
 * Features:
 *   • Big clock in/out button with live session timer
 *   • Team selector
 *   • Media attachments (links) on clock entries
 *   • Create new tickets from here
 *
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

  // Live wall-clock display
  const currentTimeDisplay = new Date(currentTime).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const currentDateDisplay = new Date(currentTime).toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

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
      <Card padding="lg" className="rounded-2xl">
        <CardContent className="flex flex-col-reverse items-center gap-4 sm:flex-row sm:items-center">
          {/* Clock button — full width on mobile, 1/4 on sm+ */}
          <div className="flex w-full flex-col items-center gap-2 sm:w-1/4">
            {activeClockEvent ? (
              <>
                <button
                  type="button"
                  onClick={clockOut}
                  disabled={clockOutLoading}
                  className="flex w-full items-center justify-center gap-3 rounded-2xl bg-red-500 py-4 text-white shadow-lg transition-transform hover:scale-[1.02] hover:bg-red-600 active:scale-95 disabled:opacity-50 sm:h-16 sm:w-16 sm:rounded-full sm:py-0"
                  aria-label="Clock out"
                >
                  <FontAwesomeIcon icon={faCircleStop} className="text-2xl" />
                  <span className="text-sm font-semibold sm:hidden">Clock Out</span>
                </button>
                <Text variant="muted" size="xs" className="hidden sm:block">
                  Tap to clock out
                </Text>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={clockIn}
                  disabled={clockInLoading || !selectedTeamId}
                  className="flex w-full items-center justify-center gap-3 rounded-2xl bg-green-500 py-4 text-white shadow-lg transition-transform hover:scale-[1.02] hover:bg-green-600 active:scale-95 disabled:opacity-50 sm:h-16 sm:w-16 sm:rounded-full sm:py-0"
                  aria-label="Clock in"
                >
                  <FontAwesomeIcon icon={faStopwatch} className="text-2xl" />
                  <span className="text-sm font-semibold sm:hidden">Clock In</span>
                </button>
                <Text variant="muted" size="xs" className="hidden sm:block">
                  Tap to clock in
                </Text>
              </>
            )}
          </div>

          {/* Time display — full width on mobile, 3/4 on sm+; border switches from top to left */}
          <div className="flex w-full flex-col items-center gap-1 border-b border-neutral-200 pb-4 text-center dark:border-neutral-700 sm:w-3/4 sm:items-start sm:border-b-0 sm:border-l sm:pb-0 sm:pl-4 sm:text-left">
            <div className="font-mono text-4xl font-bold leading-none tabular-nums">
              {currentTimeDisplay}
            </div>
            <Text variant="muted" size="sm">
              {currentDateDisplay}
            </Text>
            {activeClockEvent ? (
              <Text variant="success" size="xs" weight="medium" className="mt-1 uppercase tracking-widest">
                Session active — {formatTimer(sessionSeconds)}
              </Text>
            ) : (
              <Text variant="muted" size="xs" weight="medium" className="mt-1 uppercase tracking-widest">
                Ready to work
              </Text>
            )}
          </div>
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
                <a href="/app/work" className="text-blue-500 hover:underline">
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
