/**
 * ProfileWorkSnapshot — Active/assigned ticket snapshot shown on a user's profile.
 *
 * • Fetches tickets for each shared/own team, filters by assignedTo === userId.
 * • Excludes closed, reviewed, and deleted tickets — shows live work only.
 * • Groups by status: Blocked first, then In-Progress, then Open.
 * • Capacity/availability section is gated behind feature availability.
 */
import {
  faBoxOpen,
  faCircleDot,
  faCircleXmark,
  faClipboardList,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Badge, Card, Spinner, Text } from '@mieweb/ui';
import React, { useEffect, useMemo, useState } from 'react';

import { ticketApi, type Ticket } from '../../lib/api';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DONE_STATUSES = new Set(['closed', 'reviewed', 'deleted']);

const STATUS_ORDER = ['blocked', 'in-progress', 'open'];

const STATUS_META: Record<
  string,
  { label: string; iconClass: string; badgeVariant: 'danger' | 'warning' | 'success' | 'secondary' }
> = {
  blocked: { label: 'Blocked', iconClass: 'text-amber-500', badgeVariant: 'warning' },
  'in-progress': { label: 'In Progress', iconClass: 'text-blue-500', badgeVariant: 'success' },
  open: { label: 'Open', iconClass: 'text-neutral-400', badgeVariant: 'secondary' },
};

const PRIORITY_CLASS: Record<string, string> = {
  critical:
    'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400',
  high: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400',
  medium:
    'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-400',
};

function priorityClass(p: string | null): string {
  return (
    (p && PRIORITY_CLASS[p]) ||
    'border-neutral-200 bg-neutral-50 text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400'
  );
}

function priorityLabel(p: string | null): string | null {
  if (!p || p === 'low') return null; // low priority is noise — omit
  return p.charAt(0).toUpperCase() + p.slice(1);
}

// ─── TicketRow ────────────────────────────────────────────────────────────────

const TicketRow: React.FC<{ ticket: Ticket; teamName: string }> = ({ ticket, teamName }) => {
  const status = ticket.status ?? 'open';
  const meta = STATUS_META[status] ?? STATUS_META['open'];
  const priLabel = priorityLabel(ticket.priority);

  return (
    <li className="flex items-start gap-3 rounded-lg bg-neutral-50 px-3 py-2 dark:bg-neutral-800">
      <FontAwesomeIcon
        icon={status === 'blocked' ? faCircleXmark : faCircleDot}
        className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${meta.iconClass}`}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <Text size="sm" weight="medium" className="truncate leading-snug">
          {ticket.title}
        </Text>
        <Text variant="muted" size="xs" className="mt-0.5">
          {teamName}
        </Text>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {priLabel && (
          <span
            className={`rounded border px-1.5 py-0.5 text-xs font-medium ${priorityClass(ticket.priority)}`}
          >
            {priLabel}
          </span>
        )}
      </div>
    </li>
  );
};

// ─── ProfileWorkSnapshot ──────────────────────────────────────────────────────

interface Team {
  id: string;
  name: string;
}

interface ProfileWorkSnapshotProps {
  userId: string;
  teams: Team[];
}

export const ProfileWorkSnapshot: React.FC<ProfileWorkSnapshotProps> = ({ userId, teams }) => {
  const [allTickets, setAllTickets] = useState<Array<{ ticket: Ticket; teamName: string }>>([]);
  const [loading, setLoading] = useState(true);

  // Stable key so the effect doesn't re-run when the parent re-renders with a new array reference
  const teamsKey = teams.map((t) => t.id).join(',');

  useEffect(() => {
    if (teams.length === 0) {
      setAllTickets([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    Promise.all(
      teams.map((team) =>
        ticketApi
          .getTickets(team.id)
          .then((tickets) => tickets.map((t) => ({ ticket: t, teamName: team.name }))),
      ),
    )
      .then((results) => setAllTickets(results.flat()))
      .catch(() => setAllTickets([]))
      .finally(() => setLoading(false));
  }, [userId, teamsKey]);

  // Filter to this user's active tickets, sorted by status priority order
  const activeTickets = useMemo(() => {
    const assigned = allTickets.filter(
      ({ ticket }) => ticket.assignedTo === userId && !DONE_STATUSES.has(ticket.status ?? ''),
    );
    return [...assigned].sort((a, b) => {
      const ai = STATUS_ORDER.indexOf(a.ticket.status ?? 'open');
      const bi = STATUS_ORDER.indexOf(b.ticket.status ?? 'open');
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }, [allTickets, userId]);

  // Group by status for section headings when there are mixed statuses
  const groups = useMemo(() => {
    const map = new Map<string, Array<{ ticket: Ticket; teamName: string }>>();
    for (const entry of activeTickets) {
      const s = entry.ticket.status ?? 'open';
      const arr = map.get(s) ?? [];
      arr.push(entry);
      map.set(s, arr);
    }
    return STATUS_ORDER.flatMap((s) => {
      const entries = map.get(s);
      return entries ? [{ status: s, entries }] : [];
    });
  }, [activeTickets]);

  const blockedCount = groups.find((g) => g.status === 'blocked')?.entries.length ?? 0;

  return (
    <Card padding="lg">
      {/* Section heading */}
      <div className="mb-5 flex items-center gap-2 border-b border-neutral-200 pb-3 dark:border-neutral-700">
        <FontAwesomeIcon icon={faClipboardList} className="text-neutral-400" aria-hidden="true" />
        <Text
          size="sm"
          weight="semibold"
          className="uppercase tracking-widest text-neutral-500 dark:text-neutral-400"
        >
          Work
        </Text>

        {!loading && activeTickets.length > 0 && (
          <span className="ml-auto text-xs text-neutral-400 dark:text-neutral-500">
            {activeTickets.length} active ticket{activeTickets.length !== 1 ? 's' : ''}
            {blockedCount > 0 && (
              <span className="ml-2 font-semibold text-amber-500">· {blockedCount} blocked</span>
            )}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner size="md" />
        </div>
      ) : activeTickets.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <FontAwesomeIcon
            icon={faBoxOpen}
            className="text-2xl text-neutral-300 dark:text-neutral-600"
            aria-hidden
          />
          <Text variant="muted" size="sm">
            No active tickets assigned.
          </Text>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(({ status, entries }) => {
            const meta = STATUS_META[status] ?? STATUS_META['open'];
            return (
              <section key={status} aria-label={meta.label}>
                <div className="mb-3 flex items-center gap-2">
                  <Badge variant={meta.badgeVariant} size="sm">
                    {meta.label}
                  </Badge>
                </div>
                <ul className="flex flex-col gap-2" role="list">
                  {entries.map(({ ticket, teamName }) => (
                    <TicketRow key={ticket.id} ticket={ticket} teamName={teamName} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </Card>
  );
};
