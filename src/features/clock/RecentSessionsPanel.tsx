/**
 * RecentSessionsPanel — the Clock page's "Recent sessions" table.
 *
 * One row per day: its time ranges joined into a single line, and its total.
 * Sessions under a minute are hidden by default (most are an accidental tap);
 * "Show" reveals them across every row rather than per day.
 */
import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Spinner,
  Text,
} from '@mieweb/ui';
import React, { useMemo, useState } from 'react';

import type { ClockEvent } from '../../lib/api';
import { formatDuration, formatTime } from '../../lib/timeUtils';
import { getLocalDateKey } from './timesheetUtils';
import { formatDayGroupLabel, groupSessionsByDay, isUnderOneMinute } from './recentSessions';

// Cap by days, not raw session count: slicing sessions before grouping could
// cut a day's own list short while still showing its full total (or vice
// versa), so the row's time ranges and its "Tracked" sum would disagree.
const MAX_DAYS_SHOWN = 7;

interface RecentSessionsPanelProps {
  sessions: ClockEvent[];
  loading: boolean;
  onViewAll: () => void;
}

export const RecentSessionsPanel: React.FC<RecentSessionsPanelProps> = ({
  sessions,
  loading,
  onViewAll,
}) => {
  const [showHidden, setShowHidden] = useState(false);

  const groups = useMemo(() => groupSessionsByDay(sessions).slice(0, MAX_DAYS_SHOWN), [sessions]);
  // Not memoized — it's cheap, and the page stays open across midnight, so
  // this has to be recomputed on every render rather than pinned at mount.
  const todayKey = getLocalDateKey(Date.now());
  const hiddenCount = useMemo(
    () => groups.reduce((sum, g) => sum + g.sessions.filter(isUnderOneMinute).length, 0),
    [groups],
  );

  return (
    <div className="clock-recent-sessions flex shrink-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <Text as="h2" size="lg" weight="semibold">
          Recent sessions
        </Text>
        <Button variant="link" size="sm" onClick={onViewAll}>
          View all
        </Button>
      </div>
      {loading ? (
        <Spinner size="sm" label="Loading sessions…" />
      ) : groups.length === 0 ? (
        <Text variant="muted" size="sm">
          No sessions yet.
        </Text>
      ) : (
        <>
          <Table aria-label="Recent sessions" responsive={false}>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead>
                <TableHead>Time</TableHead>
                <TableHead className="text-end">Tracked</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => {
                const visibleSessions = showHidden
                  ? group.sessions
                  : group.sessions.filter((s) => !isUnderOneMinute(s));
                const timeRanges = visibleSessions
                  .map(
                    (s) =>
                      `${formatTime(new Date(s.startTime))} – ${formatTime(new Date(s.endTime as number))}`,
                  )
                  .join(' · ');

                return (
                  <TableRow key={group.dateKey}>
                    <TableCell className="whitespace-nowrap font-medium">
                      {formatDayGroupLabel(group.dateKey, todayKey)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{timeRanges || '—'}</TableCell>
                    <TableCell className="text-end font-mono font-semibold tabular-nums">
                      {formatDuration(group.totalSeconds)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {hiddenCount > 0 && (
            <Text variant="muted" size="xs">
              {hiddenCount} session{hiddenCount === 1 ? '' : 's'} under 1 minute{' '}
              {showHidden ? 'shown' : 'hidden'} ·{' '}
              <Button variant="link" size="sm" onClick={() => setShowHidden((v) => !v)}>
                {showHidden ? 'Hide' : 'Show'}
              </Button>
            </Text>
          )}
        </>
      )}
    </div>
  );
};
