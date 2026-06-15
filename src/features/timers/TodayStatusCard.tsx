/**
 * TodayStatusCard — shows a user's current clock-in status and active ticket.
 * Only rendered when the user is clocked in.
 *
 * @param userId - Optional user ID to show. Defaults to current logged-in user.
 */
import { faClock, faPlay } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Badge, Card, CardContent, Text } from '@mieweb/ui';
import { useCallback, useEffect, useState } from 'react';

import {
  clockApi,
  timerApi,
  ticketApi,
  type ClockEvent,
  type DayEntry,
  type Ticket,
} from '../../lib/api';
import { useTeam } from '../../lib/TeamContext';
import { useSession } from '../../lib/useSession';
import {
  formatDuration,
  formatTime,
  formatTimer,
  getActiveClockSeconds,
} from '../../lib/timeUtils';
import { useRouter } from '../../ui/router';

interface TodayStatusCardProps {
  userId?: string;
}

export function TodayStatusCard({ userId: propUserId }: TodayStatusCardProps) {
  const { user } = useSession();
  const { activeClockEvent: ownClockEvent, currentTime } = useTeam();
  const { navigate } = useRouter();
  const [todayEntries, setTodayEntries] = useState<DayEntry[]>([]);
  const [runningTicket, setRunningTicket] = useState<Ticket | null>(null);
  const [clockEvent, setClockEvent] = useState<ClockEvent | null>(null);

  // If no userId prop, use current user
  const userId = propUserId ?? user?.id;
  const isOwn = userId === user?.id;

  const fetchToday = useCallback(() => {
    if (!userId) return;
    timerApi
      .getToday(isOwn ? undefined : userId)
      .then(setTodayEntries)
      .catch(() => {});
  }, [userId, isOwn]);

  const fetchClockEvent = useCallback(() => {
    if (!userId) return;
    clockApi
      .getActive(isOwn ? undefined : userId)
      .then(setClockEvent)
      .catch(() => setClockEvent(null));
  }, [userId, isOwn]);

  // Fetch on mount and whenever clock-in state changes (own profile only)
  useEffect(() => {
    if (isOwn && !ownClockEvent) return;
    fetchToday();
    fetchClockEvent();
  }, [ownClockEvent, fetchToday, fetchClockEvent, isOwn]);

  // For non-own profiles, poll periodically
  useEffect(() => {
    if (isOwn) return;
    fetchToday();
    fetchClockEvent();
    const interval = setInterval(() => {
      fetchToday();
      fetchClockEvent();
    }, 15000); // Poll every 15 seconds
    return () => clearInterval(interval);
  }, [isOwn, fetchToday, fetchClockEvent]);

  // Re-fetch when timer mutations occur (WorkPage broadcasts this event)
  useEffect(() => {
    if (!isOwn) return;
    window.addEventListener('work:refetch', fetchToday);
    return () => window.removeEventListener('work:refetch', fetchToday);
  }, [fetchToday, isOwn]);

  // Fetch full ticket when the running entry changes (needed for github field)
  useEffect(() => {
    const runningEntry = todayEntries.find((de) => de.sessions.some((s) => s.endTime === null));
    if (!runningEntry) {
      setRunningTicket(null);
      return;
    }
    ticketApi
      .getTicket(runningEntry.entry.ticketId)
      .then(setRunningTicket)
      .catch(() => setRunningTicket(null));
  }, [todayEntries]);

  // Use fetched clock event for other users, or own from context
  const activeClockEvent = isOwn ? ownClockEvent : clockEvent;

  // Not clocked in — hide card entirely
  if (!activeClockEvent) return null;

  // Find the entry with a running session (endTime === null)
  const runningEntry = todayEntries.find((de) => de.sessions.some((s) => s.endTime === null));
  const runningSession = runningEntry?.sessions.find((s) => s.endTime === null) ?? null;

  const clockedInSeconds = getActiveClockSeconds(activeClockEvent, currentTime);
  const activeTicketSeconds = runningSession
    ? Math.max(0, Math.floor((currentTime - runningSession.startTime) / 1000))
    : 0;

  const ticketTitle = runningEntry?.entry.displayTitle ?? runningEntry?.entry.ticketId ?? null;
  const clockInTime = formatTime(new Date(activeClockEvent.startTime));
  const ticketStartTime = runningSession ? formatTime(new Date(runningSession.startTime)) : null;

  // Determine click behaviour: GitHub URL → external, otherwise in-app ticket detail
  const handleTicketClick = () => {
    if (!runningEntry) return;
    if (runningTicket?.github) {
      window.open(runningTicket.github, '_blank', 'noopener,noreferrer');
    } else {
      navigate(`/app/tickets/${runningEntry.entry.ticketId}`);
    }
  };

  return (
    <Card padding="sm" aria-label="Today's status">
      <CardContent>
        <div className="flex flex-col gap-3">
          {/* Clock-in status */}
          <div className="flex items-center gap-2 min-w-0">
            <FontAwesomeIcon icon={faClock} className="text-success shrink-0" />
            <Text size="sm" className="min-w-0">
              <span className="font-medium">Clocked in</span>
              <span className="text-muted-foreground"> since {clockInTime}</span>
            </Text>
            <Badge variant="success" size="sm" className="shrink-0 font-mono ml-auto">
              {formatTimer(clockedInSeconds)}
            </Badge>
          </div>

          {/* Divider */}
          <div className="h-px bg-border" aria-hidden="true" />

          {/* Active ticket */}
          <div className="flex items-start gap-2 min-w-0">
            <FontAwesomeIcon
              icon={faPlay}
              className={
                runningEntry
                  ? 'text-primary shrink-0 mt-0.5'
                  : 'text-muted-foreground shrink-0 mt-0.5'
              }
            />
            {runningEntry && ticketTitle ? (
              <>
                <div className="min-w-0 flex-1">
                  <Text size="sm" className="block">
                    <span className="text-muted-foreground">Working on: </span>
                    <button
                      type="button"
                      onClick={handleTicketClick}
                      className="font-medium hover:underline focus:outline-none focus-visible:underline wrap-break-word"
                      aria-label={`Open ticket: ${ticketTitle}`}
                    >
                      {ticketTitle}
                    </button>
                  </Text>
                  {ticketStartTime && (
                    <Text size="xs" className="text-muted-foreground mt-0.5">
                      since {ticketStartTime}
                    </Text>
                  )}
                </div>
                <Badge variant="secondary" size="sm" className="shrink-0 font-mono">
                  {formatDuration(activeTicketSeconds)}
                </Badge>
              </>
            ) : (
              <Text size="sm" className="text-muted-foreground">
                No active ticket
              </Text>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
