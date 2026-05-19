/**
 * TimesheetRow — Renders one or more <TableRow>s for a single clock session.
 *
 * A session that spans midnight is split into per-calendar-day segments.
 * Continuation segments show "---" for clock-in (on all but the first day)
 * and "---" for clock-out (on all but the last day), making it clear the
 * session carried over from / into an adjacent day.
 */
import { faEllipsisVertical } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Badge, Button, TableCell, TableRow, Text } from '@mieweb/ui';
import React from 'react';

import { formatDate, formatDuration, formatTime } from '../../lib/timeUtils';
import { type ClockEvent } from '../../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Team {
  id: string;
  name: string;
}

interface Props {
  session: ClockEvent;
  teams: Team[];
  onEdit: (session: ClockEvent) => void;
}

type TimelineRow = {
  kind: 'work' | 'break';
  start: number;
  end: number | null;
  durationSeconds: number | null;
  status: 'Completed' | 'Active' | 'Break Period' | 'On Break';
};

function buildTimelineRows(session: ClockEvent, now: number): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const sessionStart = session.originalStartTime ?? session.startTime;
  const sessionEnd = session.endTime ?? now;
  const rawBreaks = Array.isArray(session.breaks) ? session.breaks : [];
  const breaks = rawBreaks
    .filter((b) => typeof b.startTime === 'number')
    .map((b) => ({
      startTime: b.startTime,
      endTime: typeof b.endTime === 'number' ? b.endTime : null,
    }))
    .sort((a, b) => a.startTime - b.startTime);

  let cursor = sessionStart;
  for (const brk of breaks) {
    const breakStart = Math.max(cursor, brk.startTime);
    if (breakStart > cursor) {
      const durationSeconds = Math.max(0, Math.floor((breakStart - cursor) / 1000));
      rows.push({
        kind: 'work',
        start: cursor,
        end: breakStart,
        durationSeconds,
        status: 'Completed',
      });
    }

    const breakEnd = brk.endTime ?? (session.endTime === null ? null : sessionEnd);
    const breakDuration =
      breakEnd === null ? Math.max(0, Math.floor((now - breakStart) / 1000)) : Math.max(0, Math.floor((breakEnd - breakStart) / 1000));

    rows.push({
      kind: 'break',
      start: breakStart,
      end: breakEnd,
      durationSeconds: breakDuration,
      status: breakEnd === null ? 'On Break' : 'Break Period',
    });

    if (breakEnd !== null) {
      cursor = breakEnd;
    }
  }

  if (session.endTime === null && session.isPaused && !rows.some((row) => row.kind === 'break')) {
    const breakStart =
      typeof session.pausedAt === 'number' ? session.pausedAt : session.startTime;
    rows.push({
      kind: 'break',
      start: breakStart,
      end: null,
      durationSeconds: Math.max(0, Math.floor((now - breakStart) / 1000)),
      status: 'On Break',
    });
  }

  const shouldAddTrailingWork =
    session.endTime === null ? !session.isPaused && cursor <= sessionEnd : cursor < sessionEnd;

  if (shouldAddTrailingWork) {
    const end = session.endTime === null ? null : sessionEnd;
    const durationSeconds =
      end === null ? Math.max(0, Math.floor((now - cursor) / 1000)) : Math.max(0, Math.floor((end - cursor) / 1000));
    rows.push({
      kind: 'work',
      start: cursor,
      end,
      durationSeconds,
      status: end === null ? 'Active' : 'Completed',
    });
  }

  return rows.sort((a, b) => b.start - a.start);
}

// ─── Component ────────────────────────────────────────────────────────────────

export const TimesheetRow: React.FC<Props> = ({ session, teams, onEdit }) => {
  const teamName = teams.find((t) => t.id === session.teamId)?.name ?? session.teamId;
  const timelineRows = buildTimelineRows(session, Date.now());

  return (
    <>
      {timelineRows.map((row, idx) => {
        const showActions = idx === 0;
        return (
          <TableRow key={`${session.id}-${row.kind}-${idx}`}>
            <TableCell>{formatDate(new Date(row.start), true)}</TableCell>
            <TableCell>{formatTime(new Date(row.start))}</TableCell>
            <TableCell>
              {row.end === null ? (
                <Text variant="muted" size="xs">
                  —
                </Text>
              ) : (
                formatTime(new Date(row.end))
              )}
            </TableCell>
            <TableCell className="font-mono">
              {row.durationSeconds !== null ? formatDuration(row.durationSeconds) : '—'}
            </TableCell>
            <TableCell>{showActions ? teamName : ''}</TableCell>
            <TableCell>
              {row.status === 'Active' ? (
                <Badge variant="success" size="sm">
                  <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
                  Active
                </Badge>
              ) : row.status === 'On Break' ? (
                <Badge variant="warning" size="sm">
                  On Break
                </Badge>
              ) : (
                <Text variant="muted" size="xs">
                  {row.status}
                </Text>
              )}
            </TableCell>
            <TableCell className="text-right">
              {showActions && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Edit session"
                  onClick={() => onEdit(session)}
                >
                  <FontAwesomeIcon icon={faEllipsisVertical} className="text-sm" />
                </Button>
              )}
            </TableCell>
          </TableRow>
        );
      })}
    </>
  );
};
