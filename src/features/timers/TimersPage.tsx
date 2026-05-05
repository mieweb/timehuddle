/**
 * TimersPage — Week strip + Day view timesheet.
 *
 * Features:
 *   • 7-day week strip (Mon–Sun) with local-day totals
 *   • Day view: list of TimeEntry rows with start/stop controls
 *   • "+" action: create a new TimeEntry for the selected day
 *   • Copy from previous day
 *   • Soft-deleted ticket rows render as "Unassociated Timer"
 */
import {
  faCheck,
  faChevronLeft,
  faChevronRight,
  faCopy,
  faPause,
  faPlay,
  faSpinner,
  faTrash,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  Spinner,
  Text,
} from '@mieweb/ui';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { timerApi, ticketApi, type DayEntry, type TimerSession, type Ticket } from '../../lib/api';
import { useTeam } from '../../lib/TeamContext';
import { formatDuration } from '../../lib/timeUtils';
import { AppPage } from '../../ui/AppPage';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toLocalDateStr(d: Date): string {
  return d.toLocaleDateString('en-CA'); // "YYYY-MM-DD" in local time
}

function getWeekStart(d: Date): Date {
  const dow = d.getDay(); // 0 = Sun
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((dow + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function fmtShortDate(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
}

function runningSeconds(session: TimerSession, now: number): number {
  if (session.endTime !== null) return session.durationSeconds ?? 0;
  return Math.max(0, Math.floor((now - session.startTime) / 1000));
}

function entryTotalSeconds(sessions: TimerSession[], now: number): number {
  return sessions.reduce((sum, s) => sum + runningSeconds(s, now), 0);
}

// ─── TimersPage ───────────────────────────────────────────────────────────────

export const TimersPage: React.FC = () => {
  const { selectedTeamId, teamsReady, currentTime } = useTeam();

  // Selected day (local YYYY-MM-DD)
  const [selectedDate, setSelectedDate] = useState<string>(toLocalDateStr(new Date()));

  // Week days derived from selectedDate
  const weekDays = useMemo(() => {
    const base = new Date(selectedDate + 'T00:00:00');
    const monday = getWeekStart(base);
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }, [selectedDate]);

  // Day totals from API
  const [weekTotals, setWeekTotals] = useState<Record<string, number>>({});
  const [weekTotalsLoading, setWeekTotalsLoading] = useState(false);

  // Day entries
  const [dayEntries, setDayEntries] = useState<DayEntry[]>([]);
  const [dayLoading, setDayLoading] = useState(false);
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);

  // Running session (for live display)
  const [runningSessionId, setRunningSessionId] = useState<string | null>(null);

  // Ticket cache for title lookup
  const [ticketCache, setTicketCache] = useState<Record<string, Ticket | null>>({});

  // Team tickets for the "new entry" picker
  const [teamTickets, setTeamTickets] = useState<Ticket[]>([]);
  const [showNewEntry, setShowNewEntry] = useState(false);
  const [newEntryTicketId, setNewEntryTicketId] = useState('');
  const [newEntryLoading, setNewEntryLoading] = useState(false);

  // Copy state
  const [copyLoading, setCopyLoading] = useState(false);
  const [copyDone, setCopyDone] = useState(false);

  // ── Fetch team tickets for new entry picker ──

  useEffect(() => {
    if (!selectedTeamId) {
      setTeamTickets([]);
      return;
    }
    ticketApi
      .getTickets(selectedTeamId)
      .then(setTeamTickets)
      .catch(() => {});
  }, [selectedTeamId]);

  // ── Fetch week totals ──

  const fetchWeekTotals = useCallback(async () => {
    setWeekTotalsLoading(true);
    try {
      const days = await timerApi.getWeek(toLocalDateStr(weekDays[0]));
      const map: Record<string, number> = {};
      for (const d of days) map[d.date] = d.totalSeconds;
      setWeekTotals(map);
    } catch {
      // keep previous
    } finally {
      setWeekTotalsLoading(false);
    }
  }, [weekDays]);

  useEffect(() => {
    void fetchWeekTotals();
  }, [fetchWeekTotals]);

  // ── Fetch day entries ──

  const fetchDay = useCallback(async () => {
    setDayLoading(true);
    try {
      const entries = await timerApi.getDay(selectedDate);
      setDayEntries(entries);

      // Resolve any running session
      const running = entries.flatMap((e) => e.sessions).find((s) => s.endTime === null);
      setRunningSessionId(running?.id ?? null);
    } catch {
      // keep previous
    } finally {
      setDayLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    void fetchDay();
  }, [fetchDay]);

  // Populate ticket cache from day entries whenever entries or team tickets change
  useEffect(() => {
    if (dayEntries.length === 0) return;
    setTicketCache((prev) => {
      const next = { ...prev };
      for (const de of dayEntries) {
        const id = de.entry.ticketId;
        const fromTeam = teamTickets.find((t) => t.id === id);

        // If we can resolve from the latest team ticket list, always refresh cache.
        if (fromTeam) {
          next[id] = fromTeam;
          continue;
        }

        // Only mark as null (deleted/unassociated) once we have a loaded list.
        if (teamTickets.length > 0 && !(id in next)) {
          next[id] = null;
        }
      }
      return next;
    });
  }, [dayEntries, teamTickets]);

  // ── Handlers ──

  const handleStart = useCallback(
    async (entryId: string) => {
      try {
        const { session, closedSessionId } = await timerApi.startSession(entryId, Date.now());
        setRunningSessionId(session.id);
        // Optimistic update
        setDayEntries((prev) =>
          prev.map((de) => {
            if (de.entry.id !== entryId && !closedSessionId) return de;
            return {
              ...de,
              sessions: de.sessions
                .map((s) =>
                  s.id === closedSessionId
                    ? {
                        ...s,
                        endTime: session.startTime,
                        durationSeconds: Math.floor((session.startTime - s.startTime) / 1000),
                      }
                    : s,
                )
                .concat(de.entry.id === entryId ? [session] : []),
            };
          }),
        );
      } catch {
        void fetchDay();
      }
    },
    [fetchDay],
  );

  const handleStop = useCallback(
    async (sessionId: string) => {
      try {
        const closed = await timerApi.stopSession(sessionId, Date.now());
        setRunningSessionId(null);
        setDayEntries((prev) =>
          prev.map((de) => ({
            ...de,
            sessions: de.sessions.map((s) => (s.id === sessionId ? closed : s)),
          })),
        );
        void fetchWeekTotals();
      } catch {
        void fetchDay();
      }
    },
    [fetchDay, fetchWeekTotals],
  );

  const handleCreateEntry = useCallback(async () => {
    if (!newEntryTicketId) return;
    setNewEntryLoading(true);
    try {
      await timerApi.createEntry({ ticketId: newEntryTicketId, date: selectedDate });
      setShowNewEntry(false);
      setNewEntryTicketId('');
      void fetchDay();
    } catch {
      // ignore duplicates (entry already exists)
      setShowNewEntry(false);
    } finally {
      setNewEntryLoading(false);
    }
  }, [newEntryTicketId, selectedDate, fetchDay]);

  const handleDeleteEntry = useCallback(
    async (entryId: string, isRunning: boolean) => {
      setDeletingEntryId(entryId);
      try {
        await timerApi.deleteEntry(entryId);
        setDayEntries((prev) => prev.filter((de) => de.entry.id !== entryId));
        if (isRunning) setRunningSessionId(null);
        void fetchWeekTotals();
      } catch {
        void fetchDay();
      } finally {
        setDeletingEntryId(null);
      }
    },
    [fetchDay, fetchWeekTotals],
  );

  const handlePrevWeek = useCallback(() => {
    const base = new Date(selectedDate + 'T00:00:00');
    setSelectedDate(toLocalDateStr(addDays(base, -7)));
  }, [selectedDate]);

  const handleNextWeek = useCallback(() => {
    const base = new Date(selectedDate + 'T00:00:00');
    setSelectedDate(toLocalDateStr(addDays(base, 7)));
  }, [selectedDate]);

  const handleGoToToday = useCallback(() => {
    setSelectedDate(toLocalDateStr(new Date()));
  }, []);

  const handleCopyPrevious = useCallback(async () => {
    setCopyLoading(true);
    try {
      await timerApi.copyPrevious(selectedDate);
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 2000);
      void fetchDay();
    } catch {
      // ignore
    } finally {
      setCopyLoading(false);
    }
  }, [selectedDate, fetchDay]);

  // ── Derived ──

  const ticketOptions = useMemo(
    () =>
      teamTickets
        .filter((t) => t.status !== 'deleted')
        .map((t) => ({ value: t.id, label: t.title })),
    [teamTickets],
  );

  const selectedDayLabel = useMemo(
    () =>
      new Date(selectedDate + 'T00:00:00').toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }),
    [selectedDate],
  );

  const weekRangeLabel = useMemo(() => {
    const formatWeekDay = (d: Date) =>
      d.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      });

    return `${formatWeekDay(weekDays[0])} - ${formatWeekDay(weekDays[6])}`;
  }, [weekDays]);

  if (!teamsReady) {
    return (
      <div className="flex items-center justify-center p-12">
        <Spinner size="lg" label="Loading…" />
      </div>
    );
  }

  return (
    <AppPage subtitle={weekRangeLabel}>
      {/* ── Week Strip ── */}
      <Card padding="sm">
        <CardContent>
          <div className="flex items-center gap-1">
            <button
              onClick={handlePrevWeek}
              aria-label="Previous week"
              className="rounded-lg p-2 hover:bg-muted transition-colors flex-shrink-0"
            >
              <FontAwesomeIcon icon={faChevronLeft} className="text-xs" />
            </button>
            <div className="grid grid-cols-7 gap-1 flex-1" role="tablist" aria-label="Select day">
              {weekDays.map((day) => {
                const dateStr = toLocalDateStr(day);
                const total = weekTotals[dateStr] ?? 0;
                const isSelected = dateStr === selectedDate;
                const isToday = dateStr === toLocalDateStr(new Date());
                return (
                  <button
                    key={dateStr}
                    role="tab"
                    aria-selected={isSelected}
                    onClick={() => setSelectedDate(dateStr)}
                    className={`flex flex-col items-center rounded-lg p-2 text-xs transition-colors ${
                      isSelected
                        ? 'bg-primary text-primary-foreground'
                        : isToday
                          ? 'bg-primary/10 text-primary'
                          : 'hover:bg-muted'
                    }`}
                  >
                    <span className="font-medium">{fmtShortDate(day)}</span>
                    <span className={`mt-0.5 font-mono ${total > 0 ? '' : 'opacity-40'}`}>
                      {weekTotalsLoading ? '…' : formatDuration(total)}
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              onClick={handleNextWeek}
              aria-label="Next week"
              className="rounded-lg p-2 hover:bg-muted transition-colors flex-shrink-0"
            >
              <FontAwesomeIcon icon={faChevronRight} className="text-xs" />
            </button>
          </div>
        </CardContent>
      </Card>

      {/* ── Day Header ── */}
      <div className="flex items-center justify-between">
        <Text weight="semibold">{selectedDayLabel}</Text>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={handleGoToToday} aria-label="Go to today">
            Today
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowNewEntry(true)}
            aria-label="Add timer entry"
          >
            +
          </Button>
        </div>
      </div>

      {/* ── New Entry Form ── */}
      {showNewEntry && (
        <Card padding="md">
          <CardHeader>
            <CardTitle className="text-sm">New Timer Entry</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-2">
            <div className="flex-1">
              <Select
                label="Ticket"
                hideLabel
                options={ticketOptions}
                value={newEntryTicketId}
                onValueChange={(v) => setNewEntryTicketId(v)}
                placeholder="Select a ticket…"
                size="sm"
              />
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={handleCreateEntry}
              isLoading={newEntryLoading}
              disabled={!newEntryTicketId}
            >
              Add
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowNewEntry(false);
                setNewEntryTicketId('');
              }}
            >
              Cancel
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Day View ── */}
      {dayLoading ? (
        <div className="flex justify-center py-8">
          <Spinner size="md" label="Loading timers…" />
        </div>
      ) : dayEntries.length === 0 ? (
        <div className="py-10 text-center">
          <Text variant="muted" size="sm">
            No timers for this day. Create one with "+".
          </Text>
        </div>
      ) : (
        <Card padding="none">
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {dayEntries.map((de) => {
              const ticket = ticketCache[de.entry.ticketId];
              const isDeleted = ticket === null;
              const title = ticket ? ticket.title : isDeleted ? 'Unassociated Timer' : 'Timer';
              const total = entryTotalSeconds(de.sessions, currentTime);
              const runningSess = de.sessions.find((s) => s.endTime === null);
              const isRunning = !!runningSess;

              return (
                <li key={de.entry.id} className="flex items-center gap-3 px-4 py-3">
                  {/* Start / Stop button */}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      isRunning && runningSess
                        ? handleStop(runningSess.id)
                        : handleStart(de.entry.id)
                    }
                    disabled={!isRunning && !!runningSessionId}
                    className={`shrink-0 rounded-full ${
                      isRunning
                        ? 'bg-amber-100 text-amber-600 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-400'
                        : 'bg-green-100 text-green-600 hover:bg-green-200 dark:bg-green-900/40 dark:text-green-400'
                    }`}
                    aria-label={isRunning ? 'Stop timer' : 'Start timer'}
                  >
                    <FontAwesomeIcon icon={isRunning ? faPause : faPlay} className="text-xs" />
                  </Button>

                  {/* Title + badges */}
                  <div className="min-w-0 flex-1">
                    <Text
                      size="sm"
                      weight="medium"
                      truncate
                      variant={isDeleted ? 'muted' : 'default'}
                    >
                      {title}
                    </Text>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {isRunning && (
                        <Badge variant="success" size="sm">
                          <FontAwesomeIcon
                            icon={faSpinner}
                            className="mr-1 animate-spin text-[10px]"
                          />
                          Running
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Total duration */}
                  <Text
                    size="sm"
                    className="font-mono shrink-0"
                    variant={total > 0 ? 'default' : 'muted'}
                  >
                    {formatDuration(total)}
                  </Text>

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDeleteEntry(de.entry.id, isRunning)}
                    disabled={deletingEntryId === de.entry.id}
                    aria-label="Delete timer entry"
                    className="shrink-0 text-muted-foreground hover:text-danger"
                  >
                    <FontAwesomeIcon icon={faTrash} className="text-xs" />
                  </Button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <div className="flex justify-start">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopyPrevious}
          isLoading={copyLoading}
          aria-label="Copy entries from previous day"
        >
          <FontAwesomeIcon icon={copyDone ? faCheck : faCopy} className="mr-1" />
          {copyDone ? 'Copied entries from previous day!' : 'Copy entries from previous day'}
        </Button>
      </div>
    </AppPage>
  );
};
