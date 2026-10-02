/**
 * Pure builders for a ticket page's Activity timeline.
 *
 * Each detail page gathers different kinds of history — Huddle's activity log,
 * the viewer's own timer sessions, Redmine's journals and time entries — and
 * maps each into one `ActivityEntry` shape so `TicketActivityCard` renders them
 * as one timeline.
 */
import type {
  ActivityLogItem,
  RedmineJournal,
  RedmineTimeEntry,
  TicketSession,
} from '../../../lib/api';
import { formatDuration, formatTime } from '../../../lib/timeUtils';

export interface ActivityEntry {
  /** Unique across kinds (prefixed by kind). */
  id: string;
  /** When it happened, as an ISO string — the timeline sorts on it. */
  at: string;
  actorName: string;
  /** The sentence after the actor's name, e.g. "logged 1h 20m". */
  text: string;
  /** Secondary line: a session's clock times, or a comment's body. */
  detail?: string;
  kind: 'event' | 'session' | 'comment' | 'time';
  /** The viewer did this, for a "My activity" filter. */
  mine?: boolean;
}

function huddleEventLabel(event: ActivityLogItem): string {
  switch (event.type) {
    case 'ticket.created':
      return 'created this ticket';
    case 'ticket.updated':
      return 'updated this ticket';
    case 'ticket.deleted':
      return 'deleted this ticket';
    case 'ticket.status_changed':
      return `changed status to ${event.payload.status ?? ''}`;
    case 'ticket.assigned':
      return `assigned to ${event.payload.assigneeName ?? event.payload.assignedTo ?? 'someone'}`;
    default:
      return event.type.replace(/\./g, ' ');
  }
}

export function fromHuddleEvents(events: ActivityLogItem[]): ActivityEntry[] {
  return events.map((event) => ({
    id: `event:${event.id}`,
    at: event.occurredAt,
    actorName: event.actor.name ?? 'Someone',
    text: huddleEventLabel(event),
    kind: 'event',
  }));
}

/**
 * The viewer's own timer sessions. A finished session reads "logged 1h 20m"
 * with its clock times; a running one reads "started a timer".
 */
export function fromSessions(sessions: TicketSession[], actorName: string): ActivityEntry[] {
  return sessions.map((session) => {
    const start = new Date(session.startTime);
    const running = session.endTime == null;
    return {
      id: `session:${session.id}`,
      at: start.toISOString(),
      actorName,
      text: running
        ? 'started a timer (running)'
        : `logged ${formatDuration(session.durationSeconds ?? 0)}`,
      detail: running
        ? `Since ${formatTime(start)}`
        : `${formatTime(start)} – ${formatTime(new Date(session.endTime as number))}`,
      kind: 'session',
      mine: true,
    };
  });
}

/** "status from New to Closed" / "assignee to Priya" / "description". */
function describeChange({ field, from, to }: RedmineJournal['changes'][number]): string {
  if (from && to) return `${field} from ${from} to ${to}`;
  if (to) return `${field} to ${to}`;
  if (from) return `${field} (cleared, was ${from})`;
  return field;
}

/**
 * An issue's Redmine history: field changes, comments, or both in one entry.
 * `me` is the viewer's Redmine user id, which marks their own entries.
 */
export function fromJournals(
  journals: RedmineJournal[],
  me: number | null = null,
): ActivityEntry[] {
  return journals
    .filter((journal) => journal.createdAt)
    .map((journal) => {
      const changed = journal.changes.length
        ? `changed ${journal.changes.map(describeChange).join(', ')}`
        : '';
      return {
        id: `journal:${journal.id}`,
        at: journal.createdAt as string,
        actorName: journal.user?.name ?? 'Someone',
        text: changed || 'commented',
        detail: journal.notes || undefined,
        kind: changed ? 'event' : 'comment',
        mine: me != null && journal.user?.id === me,
      };
    });
}

/** "Sep 28" for a `YYYY-MM-DD` day, read as a local date (no timezone shift). */
function formatDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Time logged on the issue in Redmine: "logged 1h 30m in Redmine", with the
 * activity and the day it was for, then the comment. Placed on the timeline
 * when it was logged (the day it was for when Redmine gives no time).
 */
export function fromRedmineTimeEntries(
  entries: RedmineTimeEntry[],
  me: number | null = null,
): ActivityEntry[] {
  return entries
    .filter((entry) => entry.createdAt || entry.spentOn)
    .map((entry) => {
      const about = [entry.activity?.name, entry.spentOn && `for ${formatDay(entry.spentOn)}`]
        .filter(Boolean)
        .join(', ');
      return {
        id: `time:${entry.id}`,
        at: entry.createdAt ?? new Date(`${entry.spentOn}T12:00:00`).toISOString(),
        actorName: entry.user?.name ?? 'Someone',
        text: `logged ${formatDuration(Math.round(entry.hours * 3600))} in Redmine`,
        detail: [about, entry.comments].filter(Boolean).join(' — ') || undefined,
        kind: 'time',
        mine: me != null && entry.user?.id === me,
      };
    });
}

/** All entries, newest first. */
export function mergeByTime(...groups: ActivityEntry[][]): ActivityEntry[] {
  return groups.flat().sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
