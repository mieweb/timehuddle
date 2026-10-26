/**
 * RecentSessionsPanel — the Clock page's "Recent sessions" table.
 *
 * One row per day of the last 7 (the same days as the status line's "Last 7
 * days" total): its time ranges joined into a single line, and its total.
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
import React, { useState } from 'react';

import type { ClockEvent } from '../../lib/api';
import { formatDuration, formatTime } from '../../lib/timeUtils';
import { getLocalDateKey } from './timesheetUtils';
import { CLOCK_LOCALE, clockText } from './clockStrings';
import { formatDayGroupLabel, groupLast7DaysByDay, isUnderOneMinute } from './recentSessions';

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

  // Not memoized — it's cheap (at most a week of sessions), and the page stays
  // open across midnight, which moves both the window and the "Today" label,
  // so this has to be recomputed on every render rather than pinned at mount.
  const now = new Date();
  const todayKey = getLocalDateKey(now.getTime());
  const groups = groupLast7DaysByDay(sessions, now);
  const hiddenCount = groups.reduce(
    (sum, g) => sum + g.sessions.filter(isUnderOneMinute).length,
    0,
  );

  return (
    <div className="clock-recent-sessions flex shrink-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <Text as="h2" size="lg" weight="semibold">
          {clockText.recentSessions}
        </Text>
        <Button variant="link" size="sm" onClick={onViewAll}>
          {clockText.viewAll}
        </Button>
      </div>
      {loading ? (
        <Spinner size="sm" label={clockText.loadingSessions} />
      ) : groups.length === 0 ? (
        <Text variant="muted" size="sm">
          {clockText.noSessions}
        </Text>
      ) : (
        <>
          <Table aria-label={clockText.recentSessions} responsive={false}>
            <TableHeader>
              <TableRow>
                <TableHead>{clockText.columnDay}</TableHead>
                <TableHead>{clockText.columnTime}</TableHead>
                <TableHead className="text-end">{clockText.columnTracked}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => {
                const visibleSessions = showHidden
                  ? group.sessions
                  : group.sessions.filter((s) => !isUnderOneMinute(s));
                const timeRanges = visibleSessions
                  .map((s) =>
                    clockText.timeRange(
                      formatTime(new Date(s.startTime), CLOCK_LOCALE),
                      formatTime(new Date(s.endTime as number), CLOCK_LOCALE),
                    ),
                  )
                  .join(' · ');

                return (
                  <TableRow key={group.dateKey}>
                    <TableCell className="whitespace-nowrap font-medium">
                      {formatDayGroupLabel(group.dateKey, todayKey, CLOCK_LOCALE)}
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
              {clockText.shortSessions(hiddenCount, showHidden)} ·{' '}
              <Button variant="link" size="sm" onClick={() => setShowHidden((v) => !v)}>
                {clockText.showShortSessions(showHidden)}
              </Button>
            </Text>
          )}
        </>
      )}
    </div>
  );
};
