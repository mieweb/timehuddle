/**
 * TimesheetPage — Clock event history with date range filter.
 *
 * Features:
 *   • Date range presets (Today, Yesterday, 7d, This Week, 14d, Custom)
 *   • Session list with date, times, duration, team name, tickets
 *   • Summary stats (total hours, sessions, avg, working days)
 */
import { faCalendar } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Spinner,
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from '@mieweb/ui';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { useTeam } from '../../lib/TeamContext';
import { formatDuration } from '../../lib/timeUtils';
import { ApiError, clockApi, type ClockEvent } from '../../lib/api';
import { AppPage } from '../../ui/AppPage';
import { useSession } from '../../lib/useSession';
import { AttachmentsPanel } from './AttachmentsPanel';
import { TimesheetRow } from './TimesheetRow';

interface TimesheetData {
  sessions: ClockEvent[];
  summary: {
    totalSeconds: number;
    totalSessions: number;
    completedSessions: number;
    averageSessionSeconds: number;
    workingDays: number;
  };
}

type Preset = 'today' | 'yesterday' | '7d' | 'week' | '14d' | 'custom';

function getDateRange(preset: Preset): [Date, Date] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (preset) {
    case 'today':
      return [today, now];
    case 'yesterday': {
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      return [y, new Date(today.getTime() - 1)];
    }
    case '7d': {
      const d = new Date(today);
      d.setDate(d.getDate() - 7);
      return [d, now];
    }
    case 'week': {
      const d = new Date(today);
      d.setDate(d.getDate() - d.getDay());
      return [d, now];
    }
    case '14d': {
      const d = new Date(today);
      d.setDate(d.getDate() - 14);
      return [d, now];
    }
    default:
      return [today, now];
  }
}

function toLocalDateTimeInputValue(epochMs: number): string {
  const d = new Date(epochMs);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function fromLocalDateTimeInputValue(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export const TimesheetPage: React.FC = () => {
  const { user } = useSession();
  const { teamsReady, teams, selectedTeamId } = useTeam();

  const [preset, setPreset] = useState<Preset>('week');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<TimesheetData | null>(null);
  const [activeSession, setActiveSession] = useState<ClockEvent | null>(null);
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [editClockIn, setEditClockIn] = useState('');
  const [editClockOut, setEditClockOut] = useState('');
  const [sessionSaveLoading, setSessionSaveLoading] = useState(false);
  const [sessionDeleteLoading, setSessionDeleteLoading] = useState(false);
  const [sessionSaveError, setSessionSaveError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!user?.id) return;
    let startMs: number;
    let endMs: number;

    if (preset === 'custom') {
      if (!customStart || !customEnd) return;
      startMs = new Date(`${customStart}T00:00:00`).getTime();
      endMs = new Date(`${customEnd}T23:59:59.999`).getTime();
    } else {
      const [s, e] = getDateRange(preset);
      startMs = s.getTime();
      endMs = e.getTime();
    }

    setLoading(true);
    setError(null);
    try {
      const result = await clockApi.getTimesheet(user?.id ?? '', startMs, endMs);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load timesheet');
    } finally {
      setLoading(false);
    }
  }, [user?.id, preset, customStart, customEnd]);

  useEffect(() => {
    void fetchData();
  }, [preset]);

  const openSessionDialog = useCallback((session: ClockEvent) => {
    setActiveSession(session);
    setEditClockIn(toLocalDateTimeInputValue(session.startTime));
    setEditClockOut(session.endTime ? toLocalDateTimeInputValue(session.endTime) : '');
    setSessionSaveError(null);
    setSessionDialogOpen(true);
  }, []);

  const handleSaveSession = useCallback(async () => {
    if (!activeSession) return;

    const parsedStart = fromLocalDateTimeInputValue(editClockIn);
    if (parsedStart === null) {
      setSessionSaveError('Enter a valid clock-in date and time.');
      return;
    }

    let parsedEnd: number | null = null;
    if (editClockOut.trim()) {
      parsedEnd = fromLocalDateTimeInputValue(editClockOut);
      if (parsedEnd === null) {
        setSessionSaveError('Enter a valid clock-out date and time, or leave it blank.');
        return;
      }
    }

    setSessionSaveLoading(true);
    setSessionSaveError(null);
    try {
      await clockApi.updateTimes(activeSession.id, {
        startTime: parsedStart,
        endTime: parsedEnd,
      });
      setSessionDialogOpen(false);
      setActiveSession(null);
      await fetchData();
    } catch (e) {
      if (e instanceof ApiError) {
        setSessionSaveError(e.message);
      } else {
        setSessionSaveError('Unable to update session times.');
      }
    } finally {
      setSessionSaveLoading(false);
    }
  }, [activeSession, editClockIn, editClockOut, fetchData]);

  const handleDeleteSession = useCallback(async () => {
    if (!activeSession) return;

    setSessionDeleteLoading(true);
    setSessionSaveError(null);
    try {
      await clockApi.deleteEvent(activeSession.id);
      setSessionDialogOpen(false);
      setActiveSession(null);
      await fetchData();
    } catch (e) {
      if (e instanceof ApiError) {
        setSessionSaveError(e.message);
      } else {
        setSessionSaveError('Unable to delete session.');
      }
    } finally {
      setSessionDeleteLoading(false);
    }
  }, [activeSession, fetchData]);

  const presets: { key: Preset; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: '7d', label: '7 Days' },
    { key: 'week', label: 'This Week' },
    { key: '14d', label: '14 Days' },
    { key: 'custom', label: 'Custom' },
  ];

  // Filter sessions by selected team
  const filteredSessions = useMemo(() => {
    if (!data) return [];
    return selectedTeamId
      ? data.sessions.filter((s) => s.teamId === selectedTeamId)
      : data.sessions;
  }, [data, selectedTeamId]);

  // Recompute summary from filtered sessions
  const filteredSummary = useMemo(() => {
    const completed = filteredSessions.filter((s) => s.endTime !== null);
    const totalSeconds = filteredSessions.reduce((sum, s) => {
      if (s.endTime === null) return sum;
      return sum + Math.floor((s.endTime - s.startTime) / 1000);
    }, 0);
    const workingDays = new Set(
      filteredSessions.map((s) => new Date(s.startTime).toISOString().slice(0, 10)),
    ).size;
    return {
      totalSeconds,
      totalSessions: filteredSessions.length,
      completedSessions: completed.length,
      averageSessionSeconds: completed.length > 0 ? Math.floor(totalSeconds / completed.length) : 0,
      workingDays,
    };
  }, [filteredSessions]);

  if (!teamsReady) {
    return (
      <div className="flex items-center justify-center p-12">
        <Spinner size="lg" label="Loading…" />
      </div>
    );
  }

  return (
    <AppPage>
      {/* Date range filter */}
      <div className="flex flex-wrap items-center gap-2">
        {presets.map((p) => (
          <Button
            key={p.key}
            variant={preset === p.key ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setPreset(p.key)}
          >
            {p.label}
          </Button>
        ))}
      </div>

      {/* Custom date inputs */}
      {preset === 'custom' && (
        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
          <Input
            label="Start"
            type="date"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
            size="sm"
          />
          <Input
            label="End"
            type="date"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
            size="sm"
          />
          <Button
            variant="primary"
            size="sm"
            onClick={fetchData}
            disabled={loading || !customStart || !customEnd}
            isLoading={loading}
            loadingText="Applying…"
            className="w-full md:w-auto"
          >
            Apply
          </Button>
        </div>
      )}

      {/* Summary stats */}
      {data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card>
            <CardContent>
              <Text variant="muted" size="xs">
                Total Hours
              </Text>
              <Text size="lg" weight="semibold">
                {formatDuration(filteredSummary.totalSeconds)}
              </Text>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <Text variant="muted" size="xs">
                Sessions
              </Text>
              <Text size="lg" weight="semibold">
                {filteredSummary.totalSessions}
              </Text>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <Text variant="muted" size="xs">
                Avg Session
              </Text>
              <Text size="lg" weight="semibold">
                {formatDuration(filteredSummary.averageSessionSeconds)}
              </Text>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <Text variant="muted" size="xs">
                Working Days
              </Text>
              <Text size="lg" weight="semibold">
                {filteredSummary.workingDays}
              </Text>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center p-8">
          <Spinner label="Loading timesheet…" />
        </div>
      )}

      {/* Error */}
      {error && (
        <Alert variant="danger" dismissible>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Sessions list */}
      {data && filteredSessions.length > 0 && (
        <Card padding="none">
          <CardHeader className="px-5 py-3">
            <CardTitle className="text-sm">Sessions ({filteredSessions.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table responsive>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Clock In</TableHead>
                  <TableHead>Clock Out</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-16 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSessions.map((s) => (
                  <TimesheetRow key={s.id} session={s} teams={teams} onEdit={openSessionDialog} />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Modal
        open={sessionDialogOpen}
        onOpenChange={(open) => {
          setSessionDialogOpen(open);
          if (!open) {
            setActiveSession(null);
            setSessionSaveError(null);
          }
        }}
        aria-labelledby="edit-session-title"
      >
        <ModalHeader>
          <Text weight="semibold" id="edit-session-title">
            Edit Session
          </Text>
        </ModalHeader>
        <ModalBody className="space-y-4">
          <Input
            label="Clock In"
            type="datetime-local"
            value={editClockIn}
            onChange={(e) => setEditClockIn(e.target.value)}
          />
          <Input
            label="Clock Out"
            type="datetime-local"
            value={editClockOut}
            onChange={(e) => setEditClockOut(e.target.value)}
            placeholder="Leave blank to keep active"
          />
          {sessionSaveError && (
            <Text size="xs" className="text-danger">
              {sessionSaveError}
            </Text>
          )}
          {activeSession && (
            <AttachmentsPanel kind="clock" entityId={activeSession.id} currentUserId={user?.id} />
          )}
        </ModalBody>
        <ModalFooter>
          <div className="flex w-full flex-wrap items-center gap-2">
            <Button
              variant="primary"
              onClick={handleSaveSession}
              isLoading={sessionSaveLoading}
              disabled={sessionDeleteLoading}
            >
              Save
            </Button>
            <Button
              variant="ghost"
              onClick={() => setSessionDialogOpen(false)}
              disabled={sessionSaveLoading || sessionDeleteLoading}
            >
              Cancel
            </Button>
            {activeSession?.endTime !== null && (
              <Button
                variant="danger"
                className="ml-auto"
                onClick={handleDeleteSession}
                isLoading={sessionDeleteLoading}
                disabled={sessionSaveLoading}
              >
                Delete
              </Button>
            )}
          </div>
        </ModalFooter>
      </Modal>

      {data && filteredSessions.length === 0 && !loading && (
        <Card variant="outlined" padding="lg" className="border-dashed text-center">
          <CardContent>
            <FontAwesomeIcon
              icon={faCalendar}
              className="mb-2 text-2xl text-neutral-300 dark:text-neutral-600"
            />
            <Text variant="muted" size="sm">
              No clock events in this date range.
            </Text>
          </CardContent>
        </Card>
      )}
    </AppPage>
  );
};
