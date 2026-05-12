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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns midnight (local time) for the given date. */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Returns the last millisecond of the day (local time). */
function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

interface DaySegment {
  /** Calendar date label for this row */
  date: Date;
  /** Actual clock-in for this segment — null means it's a continuation */
  clockIn: Date | null;
  /** Actual clock-out for this segment — null means it continues into next day (or still active) */
  clockOut: Date | null;
  /** Duration in seconds for this segment */
  durationSeconds: number | null;
  /** Whether this is the very first segment of the session */
  isFirst: boolean;
  /** Whether this is the very last segment of the session */
  isLast: boolean;
  /** Whether the overall session is still active (no endTime) */
  isActive: boolean;
  /** Whether this segment spans more than one day in the original session */
  isMultiDay: boolean;
}

/**
 * Splits a ClockEvent into per-calendar-day segments (local time).
 * Single-day sessions produce exactly one segment.
 */
function splitIntoSegments(session: ClockEvent): DaySegment[] {
  const start = new Date(session.startTime);
  const end = session.endTime ? new Date(session.endTime) : null;

  const startDay = startOfDay(start);
  const endDay = end ? startOfDay(end) : startDay;

  // Count days spanned
  const totalDays = Math.round((endDay.getTime() - startDay.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  const isMultiDay = totalDays > 1;

  const segments: DaySegment[] = [];

  for (let i = 0; i < totalDays; i++) {
    const dayStart = new Date(startDay);
    dayStart.setDate(dayStart.getDate() + i);
    const dayEnd = endOfDay(dayStart);

    const isFirst = i === 0;
    const isLast = i === totalDays - 1;

    const segmentStart = isFirst ? start : dayStart;
    // For the last segment use the real end; otherwise clip at end-of-day.
    // If still active on the last day, segmentEnd is null.
    const segmentEnd: Date | null = isLast ? end : dayEnd;

    const durationSeconds =
      segmentEnd !== null
        ? Math.max(0, Math.floor((segmentEnd.getTime() - segmentStart.getTime()) / 1000))
        : null;

    segments.push({
      date: dayStart,
      clockIn: isFirst ? start : null,
      clockOut: isLast ? end : dayEnd,
      durationSeconds,
      isFirst,
      isLast,
      isActive: !session.endTime,
      isMultiDay,
    });
  }

  return segments;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const TimesheetRow: React.FC<Props> = ({ session, teams, onEdit }) => {
  const teamName = teams.find((t) => t.id === session.teamId)?.name ?? session.teamId;
  // clock-in day at bottom) — matching the descending sort of the session list.
  const segments = splitIntoSegments(session).reverse();

  return (
    <>
      {segments.map((seg, idx) => (
        <TableRow key={`${session.id}-day-${idx}`}>
          {/* Date */}
          <TableCell>
            <span className="flex items-center gap-1.5">
              {formatDate(seg.date, true)}
              {seg.isMultiDay && (
                <Badge variant="warning" size="sm" aria-label="Multi-day session">
                  +{segments.length}d
                </Badge>
              )}
            </span>
          </TableCell>

          {/* Clock In */}
          <TableCell>
            {seg.clockIn ? (
              formatTime(seg.clockIn)
            ) : (
              <Text variant="muted" size="xs" aria-label="Continued from previous day">
                ---
              </Text>
            )}
          </TableCell>

          {/* Clock Out */}
          <TableCell>
            {seg.isActive && seg.isLast ? (
              <Text variant="muted" size="xs">
                —
              </Text>
            ) : seg.isLast && seg.clockOut ? (
              formatTime(seg.clockOut)
            ) : (
              <Text variant="muted" size="xs" aria-label="Continued into next day">
                ---
              </Text>
            )}
          </TableCell>

          {/* Duration */}
          <TableCell className="font-mono">
            {seg.durationSeconds !== null ? formatDuration(seg.durationSeconds) : '—'}
          </TableCell>

          {/* Team — only on first row to avoid repetition */}
          <TableCell>{seg.isFirst ? teamName : ''}</TableCell>

          {/* Status */}
          <TableCell>
            {seg.isActive && seg.isLast ? (
              <Badge variant="success" size="sm">
                <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
                Active
              </Badge>
            ) : seg.isFirst ? (
              <Text variant="muted" size="xs">
                Completed
              </Text>
            ) : (
              ''
            )}
          </TableCell>

          {/* Actions — only on first row */}
          <TableCell className="text-right">
            {seg.isFirst && (
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
      ))}
    </>
  );
};
