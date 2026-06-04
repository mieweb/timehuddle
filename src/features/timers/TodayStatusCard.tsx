/**
 * TodayStatusCard — shows the user's current clock-in status and active ticket.
 * Only rendered when the user is clocked in.
 */
import { faClock, faPlay } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Badge, Card, CardContent, Text } from '@mieweb/ui';
import { useCallback, useEffect, useState } from 'react';

import { timerApi, ticketApi, type DayEntry, type Ticket } from '../../lib/api';
import { useTeam } from '../../lib/TeamContext';
import { formatDuration, formatTime, formatTimer, getActiveClockSeconds } from '../../lib/timeUtils';
import { useRouter } from '../../ui/router';

export function TodayStatusCard() {
  const { activeClockEvent, currentTime } = useTeam();
  const { navigate } = useRouter();
  const [todayEntries, setTodayEntries] = useState<DayEntry[]>([]);
  const [runningTicket, setRunningTicket] = useState<Ticket | null>(null);

  const fetchToday = useCallback(() => {
    timerApi.getToday().then(setTodayEntries).catch(() => {});
  }, []);

  // Fetch on mount and whenever clock-in state changes
  useEffect(() => {
    if (!activeClockEvent) return;
    fetchToday();
  }, [activeClockEvent, fetchToday]);

  // Re-fetch when timer mutations occur (WorkPage broadcasts this event)
  useEffect(() => {
    window.addEventListener('work:refetch', fetchToday);
    return () => window.removeEventListener('work:refetch', fetchToday);
  }, [fetchToday]);

  // Fetch full ticket when the running entry changes (needed for github field)
  useEffect(() => {
    const runningEntry = todayEntries.find((de) => de.sessions.some((s) => s.endTime === null));
    if (!runningEntry) {
      setRunningTicket(null);
      return;
    }
    ticketApi.getTicket(runningEntry.entry.ticketId).then(setRunningTicket).catch(() => setRunningTicket(null));
  }, [todayEntries]);

  // Not clocked in — hide card entirely
  if (!activeClockEvent) return null;

  // Find the entry with a running session (endTime === null)
  const runningEntry = todayEntries.find((de) =>
    de.sessions.some((s) => s.endTime === null),
  );
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
          <div className="flex items-center gap-2 min-w-0">
            <FontAwesomeIcon
              icon={faPlay}
              className={runningEntry ? 'text-primary shrink-0' : 'text-muted-foreground shrink-0'}
            />
            {runningEntry && ticketTitle ? (
              <>
                <Text size="sm" className="min-w-0 truncate flex-1">
                  <span className="text-muted-foreground">Working on: </span>
                  <button
                    type="button"
                    onClick={handleTicketClick}
                    className="font-medium hover:underline focus:outline-none focus-visible:underline"
                    aria-label={`Open ticket: ${ticketTitle}`}
                  >
                    {ticketTitle}
                  </button>
                  {ticketStartTime && (
                    <span className="text-muted-foreground"> · since {ticketStartTime}</span>
                  )}
                </Text>
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
