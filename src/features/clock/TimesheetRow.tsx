/**
 * TimesheetRow — One clock session, as an item of a session list (<ul>).
 *
 * The same layout at every width, nothing to fit into columns: its day, work
 * time and actions on the top line; clock in → clock out (bold, "+1 day" when
 * it ended after midnight) and its team; then its status and labelled
 * toggles for what's inside it:
 *   • its breaks — the session as it went, oldest first, Work and Break,
 *     with a divider where a new day starts;
 *   • its ticket timers. A ticket timer can only run while a shift is
 *     running, so every one is contained by the shift it is listed under.
 */
import {
  faChevronDown,
  faChevronRight,
  faEllipsisVertical,
  faMugHot,
  faTicket,
  faVideo,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Badge, Button, Text } from '@mieweb/ui';
import React, { useState } from 'react';

import { formatDuration, formatTime, formatWeekdayDate } from '../../lib/timeUtils';
import { type ClockEvent, type ShiftTicketSession } from '../../lib/api';
import { LinkifiedText } from '../../ui/LinkifiedText';
import { useRouter } from '../../ui/router';
import { ticketDetailPath } from '../tickets/sources/types';
import { getSessionWorkSeconds, roundDurationSecondsForDisplay } from './timesheetUtils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Team {
  id: string;
  name: string;
}

interface Props {
  session: ClockEvent;
  teams: Team[];
  onEdit: (session: ClockEvent) => void;
  /**
   * Opens the session's videos (Pulse and Upload, and what landed). Only on
   * the viewer's own sessions: the server takes a session video from its
   * owner alone.
   */
  onVideos?: (session: ClockEvent) => void;
  /** State of the latest change the viewer requested against this session. */
  changeStatus?: 'pending' | 'rejected';
  /** The reviewer's reason, shown on a declined change. */
  changeNote?: string;
  /**
   * The pending change's walkthrough (Pulse and Upload), before "Pending
   * approval". Mounted with the row, which keeps one layout at every width,
   * so an upload under way isn't lost to a resize or a closed window.
   */
  pendingAction?: React.ReactNode;
}

type TimelineRow = {
  kind: 'work' | 'break';
  start: number;
  end: number | null;
  durationSeconds: number | null;
  status: 'Completed' | 'Active' | 'Break Period' | 'On Break';
  /** Segment is a continuation from the previous calendar day (starts at midnight). */
  isContinuation?: boolean;
  /** Segment continues into the next calendar day (ends at midnight). */
  isContinued?: boolean;
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
      breakEnd === null
        ? Math.max(0, Math.floor((now - breakStart) / 1000))
        : Math.max(0, Math.floor((breakEnd - breakStart) / 1000));

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
    const breakStart = typeof session.pausedAt === 'number' ? session.pausedAt : session.startTime;
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
      end === null
        ? Math.max(0, Math.floor((now - cursor) / 1000))
        : Math.max(0, Math.floor((end - cursor) / 1000));
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

/** Returns the next midnight (start of tomorrow, local time) as a ms timestamp. */
function nextMidnight(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

/**
 * Splits timeline rows that cross a calendar-day boundary into per-day segments.
 * The first segment gets `isContinued = true` (no clock-out shown).
 * Subsequent segments get `isContinuation = true` (no clock-in shown).
 * Result is re-sorted descending by start so newest rows appear first.
 */
function splitAtMidnight(rows: TimelineRow[]): TimelineRow[] {
  const result: TimelineRow[] = [];
  for (const row of rows) {
    if (row.end === null) {
      result.push(row);
      continue;
    }
    const startDate = new Date(row.start);
    const endDate = new Date(row.end);
    const sameDay =
      startDate.getFullYear() === endDate.getFullYear() &&
      startDate.getMonth() === endDate.getMonth() &&
      startDate.getDate() === endDate.getDate();
    if (sameDay) {
      result.push(row);
      continue;
    }
    // Spans at least one midnight — split into per-calendar-day segments.
    let cursor = row.start;
    while (true) {
      const midnight = nextMidnight(cursor);
      if (midnight >= row.end) {
        // Final segment
        result.push({
          ...row,
          start: cursor,
          end: row.end,
          durationSeconds: Math.max(0, Math.floor((row.end - cursor) / 1000)),
          isContinuation: cursor !== row.start,
          isContinued: false,
        });
        break;
      } else {
        // Non-final segment — clip at midnight
        result.push({
          ...row,
          start: cursor,
          end: midnight,
          durationSeconds: Math.max(0, Math.floor((midnight - cursor) / 1000)),
          isContinuation: cursor !== row.start,
          isContinued: true,
        });
        cursor = midnight;
      }
    }
  }
  return result.sort((a, b) => b.start - a.start);
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Open a ticket session's ticket page in TimeHuddle — the Huddle ticket page, or
 * the Redmine issue page (which links on to Redmine itself). A real `href`, so
 * Cmd/Ctrl-click and middle-click still open it in a new tab.
 */
function TicketSessionLink({ ticket }: { ticket: ShiftTicketSession }) {
  const { navigate } = useRouter();
  const label = ticket.title ?? `#${ticket.ticketId}`;
  const path = ticketDetailPath({ sourceId: ticket.source, id: ticket.ticketId });
  return (
    <a
      href={path}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(path);
      }}
      // A missing ticket's "#<id>" is one long word: it wraps rather than widen the table.
      className="text-xs text-neutral-700 [overflow-wrap:anywhere] hover:text-primary hover:underline dark:text-neutral-300"
      title={label}
    >
      {label}
    </a>
  );
}

function localDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Calendar days from `start` to `end`: 1 for a shift that ended after midnight. */
function daysLater(start: number, end: number): number {
  const day = (ms: number) => {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  return Math.round((day(end) - day(start)) / 86_400_000);
}

const durationText = (seconds: number | null) =>
  seconds === null ? '—' : formatDuration(roundDurationSecondsForDisplay(seconds));

export const TimesheetRow: React.FC<Props> = ({
  session,
  teams,
  onEdit,
  onVideos,
  changeStatus,
  changeNote,
  pendingAction,
}) => {
  const teamName = teams.find((t) => t.id === session.teamId)?.name ?? session.teamId;
  // Oldest first: a session's parts read as the day went.
  const parts = splitAtMidnight(buildTimelineRows(session, Date.now())).reverse();
  // A session that ended the moment it started has no parts: it still shows
  // (and can be edited), from its own times.
  const start = parts[0]?.start ?? session.startTime;
  const end = parts.length ? parts[parts.length - 1].end : session.endTime;
  const lastStatus = parts.length
    ? parts[parts.length - 1].status
    : session.endTime === null
      ? 'Active'
      : 'Completed';
  const breaks = parts.filter((p) => p.kind === 'break');
  const breakSeconds = breaks.reduce((sum, p) => sum + (p.durationSeconds ?? 0), 0);
  const breakCount = (session.breaks ?? []).length || breaks.length;
  const ticketSessions = session.ticketSessions ?? [];
  const [breaksOpen, setBreaksOpen] = useState(false);
  const [ticketsOpen, setTicketsOpen] = useState(false);
  const breaksId = `session-breaks-${session.id}`;
  const ticketListId = `shift-tickets-${session.id}`;
  const multiDay = localDayKey(start) !== localDayKey(end ?? Date.now());
  const breaksLabel = `${breakCount} ${breakCount === 1 ? 'break' : 'breaks'}`;

  return (
    <li className="session-row px-4 py-3 sm:px-5">
      {/* Top line, as tall as the icon buttons so all of it is centred with them. */}
      <div className="session-top flex min-h-10 items-center gap-2">
        <Text as="span" size="sm" weight="semibold" truncate className="min-w-0 flex-1">
          {formatWeekdayDate(new Date(start))}
        </Text>
        <Text as="span" size="sm" className="shrink-0 whitespace-nowrap font-mono">
          {durationText(getSessionWorkSeconds(session, Date.now()))}
        </Text>
        <div className="session-actions flex shrink-0 items-center gap-1">
          {onVideos && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Videos for this session"
              title="Videos for this session"
              onClick={() => onVideos(session)}
            >
              <FontAwesomeIcon icon={faVideo} className="text-sm" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Edit session"
            onClick={() => onEdit(session)}
          >
            <FontAwesomeIcon icon={faEllipsisVertical} className="text-sm" />
          </Button>
        </div>
      </div>

      <div className="session-times flex flex-wrap items-center gap-x-2">
        <ClockRange start={start} end={end} />
        {/* Shrinks and breaks anywhere: a long unbroken team name wraps within
            the session instead of making the list scroll sideways. */}
        <Text as="span" size="sm" variant="muted" className="min-w-0 [overflow-wrap:anywhere]">
          · {teamName}
        </Text>
      </div>

      <div className="session-meta mt-2 flex flex-wrap items-center gap-1.5">
        {changeStatus === 'pending' && pendingAction}
        <SessionStatus status={lastStatus} changeStatus={changeStatus} />
        {breakCount > 0 && (
          <DisclosureChip
            icon={faMugHot}
            open={breaksOpen}
            controls={breaksId}
            label={`${breaksLabel} · ${durationText(breakSeconds)}`}
            ariaLabel={`${breaksOpen ? 'Hide' : 'Show'} ${breaksLabel} in this session`}
            onToggle={() => setBreaksOpen((open) => !open)}
          />
        )}
        {ticketSessions.length > 0 && (
          <DisclosureChip
            icon={faTicket}
            open={ticketsOpen}
            controls={ticketListId}
            label={`${ticketSessions.length} ${ticketSessions.length === 1 ? 'ticket' : 'tickets'}`}
            ariaLabel={`${ticketsOpen ? 'Hide' : 'Show'} ${ticketSessions.length} ticket timer${
              ticketSessions.length === 1 ? '' : 's'
            } for this shift`}
            onToggle={() => setTicketsOpen((open) => !open)}
          />
        )}
      </div>

      {changeStatus === 'rejected' && changeNote && (
        // The reviewer's note is shown, not hidden in a tooltip: a tooltip
        // can't be read on a phone, and its links can't be clicked.
        <Text
          size="xs"
          variant="muted"
          className="change-declined-note mt-1.5 whitespace-pre-wrap [overflow-wrap:anywhere]"
        >
          <LinkifiedText text={changeNote} />
        </Text>
      )}

      {breaksOpen && breakCount > 0 && (
        // The session as it went, with a divider where a new day starts.
        <ul id={breaksId} aria-label={`Parts of this session`} className={INNER_LIST}>
          {parts.map((part, idx) => (
            <React.Fragment key={`${part.start}-${part.kind}`}>
              {multiDay &&
                idx > 0 &&
                localDayKey(part.start) !== localDayKey(parts[idx - 1].start) && (
                  <li className="session-day pt-2">
                    <Text as="span" size="xs" weight="semibold" variant="muted">
                      {formatWeekdayDate(new Date(part.start))}
                    </Text>
                  </li>
                )}
              <li className="session-part flex flex-wrap items-center gap-x-3 py-1">
                <PartLabel part={part} />
                <span className="flex-1 whitespace-nowrap">
                  {/* The session's own clock in and clock out stand out. */}
                  <ClockTime time={part.start} strong={idx === 0} />
                  {' – '}
                  <ClockTime time={part.end} strong={idx === parts.length - 1} />
                </span>
                <Text
                  as="span"
                  size="sm"
                  variant={part.kind === 'break' ? 'muted' : undefined}
                  className="ms-auto whitespace-nowrap font-mono"
                >
                  {durationText(part.durationSeconds)}
                </Text>
              </li>
            </React.Fragment>
          ))}
        </ul>
      )}

      {ticketsOpen && ticketSessions.length > 0 && (
        <ul id={ticketListId} aria-label="Ticket timers in this session" className={INNER_LIST}>
          {ticketSessions.map((ticket) => (
            <li
              key={ticket.id}
              className="session-ticket flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1"
            >
              <span className="flex min-w-0 flex-1 basis-48 items-center gap-2">
                <FontAwesomeIcon
                  icon={faTicket}
                  className="shrink-0 text-[10px] text-muted-foreground"
                />
                <TicketSessionLink ticket={ticket} />
                {ticket.source === 'redmine' && (
                  <Badge variant="outline" size="sm" className="shrink-0">
                    Redmine
                  </Badge>
                )}
              </span>
              <Text as="span" size="xs" variant="muted" className="whitespace-nowrap">
                {formatTime(new Date(ticket.startTime))} –{' '}
                {ticket.endTime === null ? 'now' : formatTime(new Date(ticket.endTime))}
              </Text>
              <Text
                as="span"
                size="sm"
                variant="muted"
                className="ms-auto whitespace-nowrap font-mono"
              >
                {durationText(ticket.durationSeconds)}
              </Text>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
};

/** What's open under a session: set in and tied to it by a line on its left. */
const INNER_LIST = 'mt-2 border-s-2 border-border ps-3';

/** The change waiting on the session, else its state. */
const SessionStatus: React.FC<{
  status: TimelineRow['status'];
  changeStatus?: Props['changeStatus'];
}> = ({ status, changeStatus }) => {
  if (changeStatus === 'pending') {
    return (
      <Badge
        variant="warning"
        className="shrink-0 whitespace-nowrap"
        size="sm"
        title="Waiting for an admin to approve your change"
      >
        Pending approval
      </Badge>
    );
  }
  if (changeStatus === 'rejected') {
    return (
      <Badge variant="danger" size="sm">
        Change declined
      </Badge>
    );
  }
  if (status === 'Active') {
    return (
      <Badge variant="success" size="sm">
        <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
        Active
      </Badge>
    );
  }
  if (status === 'On Break') {
    return (
      <Badge variant="warning" size="sm">
        On Break
      </Badge>
    );
  }
  return (
    <Badge variant="default" size="sm">
      Completed
    </Badge>
  );
};

/**
 * Clock in → clock out, both bold, with "+1 day" when it ended on a later
 * day. Still running: "→ now".
 */
const ClockRange: React.FC<{ start: number; end: number | null }> = ({ start, end }) => {
  const plusDays = end === null ? 0 : daysLater(start, end);
  return (
    <span className="clock-range whitespace-nowrap">
      <ClockTime time={start} strong />
      {' → '}
      <ClockTime time={end} strong />
      {plusDays > 0 && (
        <Text as="span" size="xs" variant="muted" className="ms-1">
          +{plusDays} {plusDays === 1 ? 'day' : 'days'}
        </Text>
      )}
    </span>
  );
};

/** A labelled toggle for what's inside a session: its breaks, its ticket timers. */
const DisclosureChip: React.FC<{
  icon: typeof faTicket;
  label: string;
  ariaLabel: string;
  open: boolean;
  controls: string;
  onToggle: () => void;
}> = ({ icon, label, ariaLabel, open, controls, onToggle }) => (
  <Button
    variant="secondary"
    size="sm"
    className="session-disclosure h-7 rounded-full px-2.5 text-xs font-normal"
    aria-expanded={open}
    aria-controls={controls}
    aria-label={ariaLabel}
    onClick={onToggle}
  >
    <FontAwesomeIcon icon={icon} className="me-1.5 text-[10px]" />
    <span className="whitespace-nowrap">{label}</span>
    <FontAwesomeIcon icon={open ? faChevronDown : faChevronRight} className="ms-1.5 text-[9px]" />
  </Button>
);

/** What a part of a session was: work, or a break. */
const PartLabel: React.FC<{ part: TimelineRow }> = ({ part }) =>
  part.kind === 'work' ? (
    <Text as="span" size="sm" className="session-part-label w-16 shrink-0">
      Work
    </Text>
  ) : (
    <Text
      as="span"
      size="sm"
      variant="muted"
      className="session-part-label inline-flex w-16 shrink-0 items-center gap-1.5"
    >
      <FontAwesomeIcon icon={faMugHot} className="text-[10px]" />
      Break
    </Text>
  );

/**
 * A clock time. `strong` for the session's own clock in or clock out; the
 * rest (where a break started or ended, midnight) are muted. Not yet: "now".
 */
const ClockTime: React.FC<{ time: number | null; strong?: boolean }> = ({ time, strong }) => (
  <Text
    as="span"
    size="sm"
    weight={strong ? 'semibold' : undefined}
    variant={strong ? undefined : 'muted'}
    className="clock-time"
    data-strong={strong ? '' : undefined}
  >
    {time === null ? 'now' : formatTime(new Date(time))}
  </Text>
);
