/**
 * TimesheetRow — renders a clear timeline per session.
 *
 * For each session we render:
 * - one row per WORK segment
 * - one row per BREAK segment
 *
 * This makes flows explicit: work -> break -> resumed work.
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

type TimelineStatus = 'active' | 'clocked-out' | 'worked' | 'break' | 'on-break';

interface TimelineEntry {
  id: string;
  kind: 'work' | 'break';
  start: number;
  end: number | null;
  durationSeconds: number;
  status: TimelineStatus;
  metaText?: string;
}

function getSessionWorkSeconds(session: ClockEvent, now: number): number {
  if (session.endTime === null) {
    if (typeof session.workSeconds === 'number') return Math.max(0, session.workSeconds);
    const accumulated = Math.max(0, session.accumulatedTime ?? 0);
    if (session.isPaused) return accumulated;
    return accumulated + Math.max(0, Math.floor((now - session.startTime) / 1000));
  }

  const accumulated = Math.max(0, session.accumulatedTime ?? 0);
  if (accumulated > 0) return accumulated;
  return Math.max(0, Math.floor((session.endTime - session.startTime) / 1000));
}

function getBreakTimelineEntries(session: ClockEvent, now: number): TimelineEntry[] {
  const segments = Array.isArray(session.breakSegments) ? session.breakSegments : [];
  const entries = segments.map((segment, index): TimelineEntry => {
    const resumedAt = typeof segment.resumedAt === 'number' ? segment.resumedAt : null;
    const durationSeconds = Math.max(
      0,
      Math.floor(((resumedAt ?? now) - segment.pausedAt) / 1000),
    );
    return {
      id: `${session.id}-break-${index}`,
      kind: 'break',
      start: segment.pausedAt,
      end: resumedAt,
      durationSeconds,
      status: resumedAt ? 'break' : 'on-break',
      metaText: resumedAt
        ? `${formatTime(new Date(segment.pausedAt))} to ${formatTime(new Date(resumedAt))}`
        : `since ${formatTime(new Date(segment.pausedAt))}`,
    };
  });

  return entries;
}

function getWorkTimelineEntries(session: ClockEvent, now: number): TimelineEntry[] {
  const breaks = (Array.isArray(session.breakSegments) ? session.breakSegments : [])
    .filter((b): b is { pausedAt: number; resumedAt: number | null } => typeof b.pausedAt === 'number')
    .sort((a, b) => a.pausedAt - b.pausedAt);

  const totalWorkSeconds = getSessionWorkSeconds(session, now);

  if (breaks.length === 0) {
    const end =
      session.endTime ?? (session.isPaused && typeof session.pausedAt === 'number' ? session.pausedAt : now);
    const start = end - totalWorkSeconds * 1000;
    return [
      {
        id: `${session.id}-work-0`,
        kind: 'work',
        start,
        end,
        durationSeconds: totalWorkSeconds,
        status: session.endTime ? 'clocked-out' : session.isPaused ? 'worked' : 'active',
      },
    ];
  }

  const knownSegments: Array<{ start: number; end: number }> = [];

  for (let i = 0; i < breaks.length - 1; i += 1) {
    const resume = breaks[i].resumedAt;
    const nextPause = breaks[i + 1].pausedAt;
    if (typeof resume === 'number' && nextPause > resume) {
      knownSegments.push({ start: resume, end: nextPause });
    }
  }

  const lastBreak = breaks[breaks.length - 1];
  if (typeof lastBreak.resumedAt === 'number') {
    const lastEnd = session.endTime ?? now;
    if (lastEnd > lastBreak.resumedAt) {
      knownSegments.push({ start: lastBreak.resumedAt, end: lastEnd });
    }
  }

  const knownSeconds = knownSegments.reduce(
    (sum, seg) => sum + Math.max(0, Math.floor((seg.end - seg.start) / 1000)),
    0,
  );
  const firstEnd = breaks[0].pausedAt;
  const firstSeconds = Math.max(0, totalWorkSeconds - knownSeconds);
  const firstStart = firstEnd - firstSeconds * 1000;

  const workSegments = [{ start: firstStart, end: firstEnd }, ...knownSegments];

  return workSegments.map((seg, index) => {
    const isLast = index === workSegments.length - 1;
    let status: TimelineStatus = 'worked';
    if (isLast) {
      if (session.endTime) status = 'clocked-out';
      else if (!session.isPaused) status = 'active';
    }

    return {
      id: `${session.id}-work-${index}`,
      kind: 'work',
      start: seg.start,
      end: seg.end,
      durationSeconds: Math.max(0, Math.floor((seg.end - seg.start) / 1000)),
      status,
    };
  });
}

function getTimelineEntries(session: ClockEvent, now: number): TimelineEntry[] {
  const workEntries = getWorkTimelineEntries(session, now);
  const breakEntries = getBreakTimelineEntries(session, now);

  return [...workEntries, ...breakEntries].sort((a, b) => {
    if (b.start !== a.start) return b.start - a.start;
    if (a.kind === b.kind) return 0;
    return a.kind === 'work' ? -1 : 1;
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export const TimesheetRow: React.FC<Props> = ({ session, teams, onEdit }) => {
  const teamName = teams.find((t) => t.id === session.teamId)?.name ?? session.teamId;
  const now = Date.now();
  const timeline = getTimelineEntries(session, now);

  return (
    <>
      {timeline.map((entry, index) => (
        <TableRow key={entry.id}>
          <TableCell>
            <span className={entry.kind === 'break' ? 'pl-4' : ''}>
              {formatDate(new Date(entry.start), true)}
            </span>
          </TableCell>

          <TableCell>
            {formatTime(new Date(entry.start))}
          </TableCell>

          <TableCell>
            {entry.end ? (
              formatTime(new Date(entry.end))
            ) : (
              <Text variant="muted" size="xs">
                —
              </Text>
            )}
          </TableCell>

          <TableCell className="font-mono">
            {formatDuration(entry.durationSeconds)}
          </TableCell>

          <TableCell>
            {entry.kind === 'work' ? teamName : <Text variant="muted" size="xs">{teamName}</Text>}
          </TableCell>

          <TableCell>
            {entry.status === 'active' ? (
              <Badge variant="success" size="sm">
                <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
                Active
              </Badge>
            ) : entry.status === 'clocked-out' ? (
              <Badge variant="secondary" size="sm">
                Clocked Out
              </Badge>
            ) : entry.status === 'on-break' ? (
              <Badge variant="warning" size="sm">
                On Break
              </Badge>
            ) : entry.status === 'break' ? (
              <Badge variant="secondary" size="sm">
                Break
              </Badge>
            ) : (
              <Text variant="muted" size="xs">
                Worked
              </Text>
            )}
          </TableCell>

          <TableCell className="text-right">
            {entry.kind === 'break' ? (
              <Text variant="muted" size="xs">
                {entry.metaText ?? ''}
              </Text>
            ) : index === 0 ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Edit session"
                onClick={() => onEdit(session)}
              >
                <FontAwesomeIcon icon={faEllipsisVertical} className="text-sm" />
              </Button>
            ) : null}
          </TableCell>
        </TableRow>
      ))}
    </>
  );
};
