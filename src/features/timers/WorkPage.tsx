/**
 * WorkPage — Week strip + Day view timesheet.
 *
 * Features:
 *   • 7-day week strip (Mon–Sun) with local-day totals
 *   • Day view: list of work item rows with start/stop controls
 *   • "+" action: create a new work item for the selected day
 *   • Copy from previous day
 *   • Soft-deleted ticket rows render as "Unassociated Timer"
 */
import {
  faCheck,
  faChevronLeft,
  faChevronRight,
  faCopy,
  faPause,
  faPen,
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
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Select,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from '@mieweb/ui';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import {
  ApiError,
  timerApi,
  ticketApi,
  type DayEntry,
  type TimerSession,
  type Ticket,
} from '../../lib/api';
import { useTeam } from '../../lib/TeamContext';
import { formatDuration } from '../../lib/timeUtils';
import { AppPage } from '../../ui/AppPage';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toLocalDateStr(d: Date): string {
  return d.toLocaleDateString('en-CA'); // "YYYY-MM-DD" in local time
}

/** Format total seconds as "H:MM" for the duration input field. */
function secondsToHHMM(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** Parse "H:MM" or "HH:MM" to seconds. Returns null if invalid. */
function hhmmToSeconds(value: string): number | null {
  const match = value.trim().match(/^(\d+):([0-5]\d)$/);
  if (!match) return null;
  return parseInt(match[1], 10) * 3600 + parseInt(match[2], 10) * 60;
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

// ─── WorkPage ─────────────────────────────────────────────────────────────────

export const WorkPage: React.FC = () => {
  const { teams, selectedTeamId, teamsReady, currentTime } = useTeam();

  // Selected day (local YYYY-MM-DD)
  const [selectedDate, setSelectedDate] = useState<string>(toLocalDateStr(new Date()));

  // Whether the selected day is today (updates reactively at midnight via currentTime)
  const isToday = selectedDate === toLocalDateStr(new Date(currentTime));
  const isFuture = selectedDate > toLocalDateStr(new Date(currentTime));

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
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);

  // Running session (for live display)
  const [runningSessionId, setRunningSessionId] = useState<string | null>(null);

  // Team tickets for the "new entry" picker
  const [teamTickets, setTeamTickets] = useState<Ticket[]>([]);
  const [showNewEntry, setShowNewEntry] = useState(false);
  const [newEntryTicketId, setNewEntryTicketId] = useState('');
  const [newEntryNote, setNewEntryNote] = useState('');
  const [newEntryLoading, setNewEntryLoading] = useState(false);

  // Copy state
  const [copyLoading, setCopyLoading] = useState(false);
  const [copyDone, setCopyDone] = useState(false);

  // All tickets across all user teams (for edit modal)
  const [allTickets, setAllTickets] = useState<Ticket[]>([]);

  // Edit modal state
  const [editEntry, setEditEntry] = useState<DayEntry | null>(null);
  const [editNote, setEditNote] = useState('');
  const [editDuration, setEditDuration] = useState('');
  const [editTicketId, setEditTicketId] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [editLoading, setEditLoading] = useState(false);

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

  // ── Fetch all tickets across all teams (for edit modal picker) ──

  useEffect(() => {
    if (teams.length === 0) return;
    Promise.all(teams.map((t) => ticketApi.getTickets(t.id).catch(() => [] as Ticket[])))
      .then((results) => {
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
        setAllTickets(merged);
      })
      .catch(() => {});
  }, [teams]);

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
    try {
      const entries = await timerApi.getDay(selectedDate);
      setDayEntries(entries);

      // Resolve any running session
      const running = entries.flatMap((e) => e.sessions).find((s) => s.endTime === null);
      setRunningSessionId(running?.id ?? null);
    } catch {
      // keep previous
    }
  }, [selectedDate]);

  useEffect(() => {
    void fetchDay();
  }, [fetchDay]);

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
      await timerApi.createEntry({
        ticketId: newEntryTicketId,
        date: selectedDate,
        note: newEntryNote.trim() ? newEntryNote.trim() : undefined,
      });
      setShowNewEntry(false);
      setNewEntryTicketId('');
      setNewEntryNote('');
      void fetchDay();
    } catch {
      // ignore duplicates (entry already exists)
      setShowNewEntry(false);
    } finally {
      setNewEntryLoading(false);
    }
  }, [newEntryTicketId, newEntryNote, selectedDate, fetchDay]);

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

  const handleOpenEdit = useCallback((de: DayEntry) => {
    const total = entryTotalSeconds(de.sessions, Date.now());
    setEditEntry(de);
    setEditNote(de.entry.note ?? '');
    setEditDuration(secondsToHHMM(total));
    setEditTicketId(de.entry.ticketId);
    setEditError(null);
  }, []);

  const handleUpdateEntry = useCallback(async () => {
    if (!editEntry) return;
    const parsedSeconds = hhmmToSeconds(editDuration);
    const isRunning = !!editEntry.sessions.find((s) => s.endTime === null);
    const ticketChanged = editTicketId !== editEntry.entry.ticketId;
    setEditLoading(true);
    setEditError(null);
    try {
      const updated = await timerApi.updateEntry(editEntry.entry.id, {
        note: editNote || null,
        ...(!isRunning && parsedSeconds !== null ? { durationSeconds: parsedSeconds } : {}),
        ...(ticketChanged ? { ticketId: editTicketId } : {}),
      });
      setDayEntries((prev) =>
        prev.map((de) => (de.entry.id === updated.id ? { ...de, entry: updated } : de)),
      );
      if (!isRunning && parsedSeconds !== null) void fetchDay();
      setEditEntry(null);
    } catch (error) {
      if (error instanceof ApiError) {
        setEditError(error.message);
      } else {
        setEditError('Unable to update work item. Please try again.');
      }
    } finally {
      setEditLoading(false);
    }
  }, [editEntry, editNote, editDuration, editTicketId, fetchDay]);

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

  const ticketsById = useMemo(() => {
    const map = new Map<string, Ticket>();
    for (const ticket of allTickets) map.set(ticket.id, ticket);
    return map;
  }, [allTickets]);

  const teamNamesById = useMemo(() => {
    const map = new Map<string, string>();
    for (const team of teams) map.set(team.id, team.name);
    return map;
  }, [teams]);

  const getWorkItemLabel = useCallback(
    (entry: DayEntry['entry']) => {
      const ticket = ticketsById.get(entry.ticketId);
      const baseTitle = entry.displayTitle || ticket?.title || '(untitled)';
      const teamName = ticket ? teamNamesById.get(ticket.teamId) : undefined;
      return teamName ? `${baseTitle} - ${teamName}` : baseTitle;
    },
    [ticketsById, teamNamesById],
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
    <AppPage>
      {/* ── Page Header: week nav + today + week range ── */}
      <div className="flex items-center justify-between gap-3">
        <Text weight="semibold" className="truncate">
          {weekRangeLabel}
        </Text>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={handlePrevWeek}
            aria-label="Previous week"
            className="rounded-lg p-2 hover:bg-muted transition-colors flex-shrink-0"
          >
            <FontAwesomeIcon icon={faChevronLeft} className="text-xs" />
          </button>
          <Button variant="ghost" size="sm" onClick={handleGoToToday} aria-label="Go to today">
            Today
          </Button>
          <button
            onClick={handleNextWeek}
            aria-label="Next week"
            className="rounded-lg p-2 hover:bg-muted transition-colors flex-shrink-0"
          >
            <FontAwesomeIcon icon={faChevronRight} className="text-xs" />
          </button>
        </div>
      </div>

      {/* ── Week Strip + Add Button ── */}
      <div className="flex flex-col gap-2 sm:gap-0">
        {/* On small screens: full-width add button above the strip */}
        <Button
          variant="primary"
          size="sm"
          onClick={() => setShowNewEntry(true)}
          aria-label="Add work item"
          className="w-full sm:hidden"
        >
          + Add Work Item
        </Button>

        <Card padding="sm">
          <CardContent>
            <div className="flex items-center gap-1">
              {/* On wider screens: + button sits left of the day selectors */}
              <Button
                variant="primary"
                size="icon"
                onClick={() => setShowNewEntry(true)}
                aria-label="Add work item"
                className="hidden sm:flex flex-shrink-0 mr-1"
              >
                +
              </Button>
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
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Day Header ── */}
      <div className="flex items-center">
        <Text weight="semibold">{selectedDayLabel}</Text>
      </div>

      {/* ── New Entry Modal ── */}
      <Modal
        open={showNewEntry}
        onOpenChange={(o) => {
          setShowNewEntry(o);
          if (!o) {
            setNewEntryTicketId('');
            setNewEntryNote('');
          }
        }}
        aria-labelledby="new-entry-title"
      >
        <ModalHeader>
          <Text weight="semibold" id="new-entry-title">
            Add work item for{' '}
            {new Date(selectedDate + 'T00:00:00').toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </Text>
        </ModalHeader>
        <ModalBody className="flex flex-col gap-4">
          <Select
            label="Ticket"
            searchable
            searchPlaceholder="Search tickets…"
            options={ticketOptions}
            value={newEntryTicketId}
            onValueChange={(v) => setNewEntryTicketId(v)}
            placeholder="Select a ticket…"
          />
          <Input
            label="Note (optional)"
            value={newEntryNote}
            onChange={(e) => setNewEntryNote(e.target.value)}
            placeholder="Note (optional)"
          />
        </ModalBody>
        <ModalFooter>
          <div className="flex gap-2">
            <Button
              variant="primary"
              onClick={handleCreateEntry}
              isLoading={newEntryLoading}
              disabled={!newEntryTicketId}
            >
              Add work item
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setShowNewEntry(false);
                setNewEntryTicketId('');
                setNewEntryNote('');
              }}
            >
              Cancel
            </Button>
          </div>
        </ModalFooter>
      </Modal>

      {/* ── Day View ── */}
      {dayEntries.length === 0 ? (
        <div className="py-10 text-center">
          <Text variant="muted" size="sm">
            No timers for this day. Create one with "+".
          </Text>
        </div>
      ) : (
        <Card padding="none">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Work Item</TableHead>
                <TableHead className="text-right">Time</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {dayEntries.map((de) => {
                const title = getWorkItemLabel(de.entry);
                const total = entryTotalSeconds(de.sessions, currentTime);
                const runningSess = de.sessions.find((s) => s.endTime === null);
                const isRunning = !!runningSess;

                return (
                  <TableRow key={de.entry.id}>
                    {/* Start / Stop */}
                    <TableCell className="py-2 pr-0">
                      <span
                        title={
                          !isRunning && !isToday
                            ? 'Timers can only run on the current day — editing this entry is still available.'
                            : undefined
                        }
                        style={{ cursor: !isRunning && !isToday ? 'not-allowed' : undefined }}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            isRunning && runningSess
                              ? handleStop(runningSess.id)
                              : handleStart(de.entry.id)
                          }
                          disabled={!isRunning && (!!runningSessionId || !isToday)}
                          style={!isRunning && !isToday ? { pointerEvents: 'none' } : undefined}
                          className={`rounded-full ${
                            isRunning
                              ? 'bg-amber-100 text-amber-600 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-400'
                              : 'bg-green-100 text-green-600 hover:bg-green-200 dark:bg-green-900/40 dark:text-green-400'
                          }`}
                          aria-label={isRunning ? 'Stop timer' : 'Start timer'}
                        >
                          <FontAwesomeIcon
                            icon={isRunning ? faPause : faPlay}
                            className="text-xs"
                          />
                        </Button>
                      </span>
                    </TableCell>

                    {/* Title + note + running badge */}
                    <TableCell className="py-2">
                      <div className="flex items-center gap-2">
                        <div className="min-w-0">
                          <Text size="sm" weight="medium" truncate>
                            {title}
                          </Text>
                          {de.entry.note?.trim() && (
                            <Text size="xs" variant="muted" truncate>
                              {de.entry.note.trim()}
                            </Text>
                          )}
                        </div>
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
                    </TableCell>

                    {/* Duration */}
                    <TableCell className="py-2 text-right font-mono">
                      <Text size="sm" variant={total > 0 ? 'default' : 'muted'}>
                        {formatDuration(total)}
                      </Text>
                    </TableCell>

                    {/* Actions */}
                    <TableCell className="py-2">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenEdit(de)}
                          aria-label="Edit work item"
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <FontAwesomeIcon icon={faPen} className="text-xs" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteEntry(de.entry.id, isRunning)}
                          disabled={deletingEntryId === de.entry.id}
                          aria-label="Delete work item"
                          className="text-muted-foreground hover:text-danger"
                        >
                          <FontAwesomeIcon icon={faTrash} className="text-xs" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {isFuture && dayEntries.length === 0 && (
        <div className="flex justify-start">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopyPrevious}
            isLoading={copyLoading}
            aria-label="Copy entries from previous day"
          >
            <FontAwesomeIcon icon={copyDone ? faCheck : faCopy} className="mr-1" />
            {copyDone
              ? 'Copied entries from most recent timesheet!'
              : 'Copy entries from most recent timesheet'}
          </Button>
        </div>
      )}

      {/* ── Edit Modal ── */}
      {editEntry &&
        (() => {
          const isRunning = !!editEntry.sessions.find((s) => s.endTime === null);
          return (
            <Modal
              open
              onOpenChange={(o) => {
                if (!o) setEditEntry(null);
              }}
              aria-labelledby="edit-entry-title"
            >
              <ModalHeader>
                <Text weight="semibold" id="edit-entry-title">
                  Edit work item for{' '}
                  {new Date(editEntry.entry.date + 'T00:00:00').toLocaleDateString(undefined, {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}
                </Text>
              </ModalHeader>
              <ModalBody className="flex flex-col gap-4">
                <Select
                  label="Ticket"
                  searchable
                  searchPlaceholder="Search tickets…"
                  options={allTickets
                    .filter((t) => t.status !== 'deleted')
                    .map((t) => ({ value: t.id, label: t.title }))}
                  value={editTicketId}
                  onValueChange={(v) => setEditTicketId(v)}
                  placeholder="Select a ticket…"
                />
                <Input
                  label="Note (optional)"
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  placeholder="Note (optional)"
                />
                <Input
                  label="Duration"
                  value={editDuration}
                  onChange={(e) => setEditDuration(e.target.value)}
                  placeholder="H:MM"
                  disabled={isRunning}
                  aria-describedby={isRunning ? 'duration-running-hint' : undefined}
                />
                {isRunning && (
                  <Text size="xs" variant="muted" id="duration-running-hint">
                    Duration cannot be edited while the timer is running.
                  </Text>
                )}
                {editError && (
                  <Text size="xs" className="text-danger">
                    {editError}
                  </Text>
                )}
              </ModalBody>
              <ModalFooter className="flex items-center justify-between">
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    onClick={handleUpdateEntry}
                    isLoading={editLoading}
                    disabled={!isRunning && hhmmToSeconds(editDuration) === null}
                  >
                    Update work item
                  </Button>
                  <Button variant="ghost" onClick={() => setEditEntry(null)}>
                    Cancel
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  onClick={() => {
                    void handleDeleteEntry(editEntry.entry.id, isRunning);
                    setEditEntry(null);
                  }}
                  className="text-danger hover:text-danger"
                  aria-label="Delete work item"
                >
                  Delete
                </Button>
              </ModalFooter>
            </Modal>
          );
        })()}
    </AppPage>
  );
};
