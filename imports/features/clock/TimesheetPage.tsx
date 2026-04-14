/**
 * TimesheetPage — Clock event history with date range filter.
 *
 * Features:
 *   • Date range presets (Today, Yesterday, 7d, This Week, 14d, Custom)
 *   • Session list with date, times, duration, team name, tickets
 *   • Summary stats (total hours, sessions, avg, working days)
 */
import {
  faCalendar
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from '@mieweb/ui';
import { Meteor } from 'meteor/meteor';
import React, { useCallback, useEffect, useState } from 'react';

import { useTeam } from '../../lib/TeamContext';
import { formatDuration, formatTime, formatDate, toDateString } from '../../lib/timeUtils';
import { useMethod } from '../../lib/useMethod';

interface TimesheetSession {
  id: string;
  date: string;
  startTime: Date;
  endTime: Date | null;
  duration: number | null;
  isActive: boolean;
  teamName: string | null;
  teamId: string;
  accumulatedTime: number;
}

interface TimesheetData {
  sessions: TimesheetSession[];
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

export const TimesheetPage: React.FC = () => {
  const userId = Meteor.userId();
  const { teamsReady } = useTeam();

  const [preset, setPreset] = useState<Preset>('week');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const getTimesheet = useMethod<
    [{ userId: string; startDate: string; endDate: string }],
    TimesheetData
  >('clock.getTimesheetData');

  const [data, setData] = useState<TimesheetData | null>(null);

  const fetchData = useCallback(async () => {
    if (!userId) return;

    let startDate: string;
    let endDate: string;

    if (preset === 'custom') {
      if (!customStart || !customEnd) return;
      startDate = customStart;
      endDate = customEnd;
    } else {
      const [s, e] = getDateRange(preset);
      startDate = toDateString(s);
      endDate = toDateString(e);
    }

    try {
      const result = await getTimesheet.call({ userId, startDate, endDate });
      setData(result);
    } catch {
      // Error is in getTimesheet.error
    }
  }, [userId, preset, customStart, customEnd, getTimesheet]);

  useEffect(() => {
    fetchData();
  }, [preset]);

  const presets: { key: Preset; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: '7d', label: '7 Days' },
    { key: 'week', label: 'This Week' },
    { key: '14d', label: '14 Days' },
    { key: 'custom', label: 'Custom' },
  ];

  if (!teamsReady) {
    return (
      <div className="flex items-center justify-center p-12">
        <Spinner size="lg" label="Loading…" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
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
        <div className="flex flex-wrap items-end gap-3">
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
            disabled={getTimesheet.loading || !customStart || !customEnd}
            isLoading={getTimesheet.loading}
            loadingText="Applying…"
          >
            Apply
          </Button>
        </div>
      )}

      {/* Summary stats */}
      {data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card><CardContent>
            <Text variant="muted" size="xs">Total Hours</Text>
            <Text size="lg" weight="semibold">{formatDuration(data.summary.totalSeconds)}</Text>
          </CardContent></Card>
          <Card><CardContent>
            <Text variant="muted" size="xs">Sessions</Text>
            <Text size="lg" weight="semibold">{data.summary.totalSessions}</Text>
          </CardContent></Card>
          <Card><CardContent>
            <Text variant="muted" size="xs">Avg Session</Text>
            <Text size="lg" weight="semibold">{formatDuration(data.summary.averageSessionSeconds)}</Text>
          </CardContent></Card>
          <Card><CardContent>
            <Text variant="muted" size="xs">Working Days</Text>
            <Text size="lg" weight="semibold">{data.summary.workingDays}</Text>
          </CardContent></Card>
        </div>
      )}

      {/* Loading */}
      {getTimesheet.loading && (
        <div className="flex items-center justify-center p-8">
          <Spinner label="Loading timesheet…" />
        </div>
      )}

      {/* Error */}
      {getTimesheet.error && (
        <Alert variant="danger" dismissible>
          <AlertDescription>{getTimesheet.error}</AlertDescription>
        </Alert>
      )}

      {/* Sessions list */}
      {data && data.sessions.length > 0 && (
        <Card padding="none">
          <CardHeader className="px-5 py-3">
            <CardTitle className="text-sm">Clock Events ({data.sessions.length})</CardTitle>
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.sessions.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{formatDate(new Date(s.startTime), true)}</TableCell>
                    <TableCell>{formatTime(new Date(s.startTime))}</TableCell>
                    <TableCell>{s.endTime ? formatTime(new Date(s.endTime)) : '—'}</TableCell>
                    <TableCell className="font-mono">{s.duration ? formatDuration(s.duration) : '—'}</TableCell>
                    <TableCell>{s.teamName ?? '—'}</TableCell>
                    <TableCell>
                      {s.isActive ? (
                        <Badge variant="success" size="sm">
                          <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
                          Active
                        </Badge>
                      ) : (
                        <Text variant="muted" size="xs">Completed</Text>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {data && data.sessions.length === 0 && !getTimesheet.loading && (
        <Card variant="outlined" padding="lg" className="border-dashed text-center">
          <CardContent>
            <FontAwesomeIcon icon={faCalendar} className="mb-2 text-2xl text-neutral-300 dark:text-neutral-600" />
            <Text variant="muted" size="sm">No clock events in this date range.</Text>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
