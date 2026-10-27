/**
 * Pure builders for a ticket page's Activity timeline.
 *
 * Each detail page gathers different kinds of history — Huddle's activity log,
 * the viewer's own timer sessions, a carried issue's conversation — and
 * maps each into one `ActivityEntry` shape so `TicketActivityCard` renders them
 * as one timeline.
 */
import type { ConversationEntry } from '@timehuddle/ticket-sources';

import type { ActivityLogItem, TicketSession } from '../../../lib/api';
import { formatDuration, formatTime } from '../../../lib/timeUtils';
import { linkActivitySentence } from '../link/ticketLinkStrings';

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
      return linkActivitySentence(event.payload) ?? 'updated this ticket';
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
function describeChange({
  field,
  from,
  to,
}: {
  field: string;
  from?: string;
  to?: string;
}): string {
  if (from && to) return `${field} from ${from} to ${to}`;
  if (to) return `${field} to ${to}`;
  if (from) return `${field} (cleared, was ${from})`;
  return field;
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
 * A carried issue's conversation (#757): its comments, field changes and the
 * time logged on it in the source. Changes and a comment made together (same
 * person, same moment) read as one entry, as the source shows them. `me` is
 * the viewer's id in the source, which marks their own; `source` names it,
 * for "logged 1h 30m in Redmine".
 */
export function fromConversation(
  conversation: ConversationEntry[],
  { me = null, source }: { me?: string | null; source: string },
): ActivityEntry[] {
  const times: ActivityEntry[] = [];
  const together = new Map<
    string,
    { id: string; at: string; actorName: string; mine: boolean; changes: string[]; note?: string }
  >();
  for (const entry of conversation) {
    const actorName = entry.author?.name ?? 'Someone';
    const mine = me != null && entry.author?.id === me;
    if (entry.kind === 'time') {
      const day = entry.on && `for ${formatDay(entry.on)}`;
      times.push({
        id: `outside:${entry.id}`,
        at: entry.at,
        actorName,
        text: `logged ${formatDuration(entry.seconds)} in ${source}`,
        detail: [entry.text?.text, day].filter(Boolean).join(', ') || undefined,
        kind: 'time',
        mine,
      });
      continue;
    }
    const key = `${entry.author?.id ?? ''}@${entry.at}`;
    const group = together.get(key) ?? { id: entry.id, at: entry.at, actorName, mine, changes: [] };
    if (entry.kind === 'comment') group.note = entry.text.text;
    else group.changes.push(describeChange(entry));
    together.set(key, group);
  }
  const grouped = [...together.values()].map(
    ({ id, at, actorName, mine, changes, note }): ActivityEntry => ({
      id: `outside:${id}`,
      at,
      actorName,
      text: changes.length ? `changed ${changes.join(', ')}` : 'commented',
      detail: note || undefined,
      kind: changes.length ? 'event' : 'comment',
      mine,
    }),
  );
  return [...grouped, ...times];
}

/** All entries, newest first. */
export function mergeByTime(...groups: ActivityEntry[][]): ActivityEntry[] {
  return groups.flat().sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
