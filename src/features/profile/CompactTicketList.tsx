/**
 * CompactTicketList — Minimal ticket list for embedded profile views (e.g., org chart lightbox).
 *
 * Shows active tickets for a user with a clean, compact design.
 * Reuses ticket rendering logic from ProfileWorkSnapshot.
 */
import { faCircleDot, faCircleXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Spinner, Text } from '@mieweb/ui';
import React, { useMemo } from 'react';

import { type Ticket } from '../../lib/api';

const STATUS_META: Record<string, { label: string; iconClass: string }> = {
  blocked: { label: 'Blocked', iconClass: 'text-amber-500' },
  'in-progress': { label: 'In Progress', iconClass: 'text-blue-500' },
  open: { label: 'Open', iconClass: 'text-neutral-400' },
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
  if (!p || p === 'low') return null;
  return p.charAt(0).toUpperCase() + p.slice(1);
}

interface CompactTicketListProps {
  tickets: Array<{ ticket: Ticket; teamName: string }>;
  loading: boolean;
  maxItems?: number;
}

export const CompactTicketList: React.FC<CompactTicketListProps> = ({
  tickets,
  loading,
  maxItems = 3,
}) => {
  const displayTickets = useMemo(() => tickets.slice(0, maxItems), [tickets, maxItems]);
  const hiddenCount = Math.max(0, tickets.length - maxItems);

  if (loading) {
    return (
      <div className="flex justify-center py-3">
        <Spinner size="sm" />
      </div>
    );
  }

  if (tickets.length === 0) {
    return (
      <p className="text-center text-xs text-neutral-400 dark:text-neutral-500">
        No active tickets
      </p>
    );
  }

  return (
    <ul className="space-y-2" role="list">
      {displayTickets.map(({ ticket, teamName }) => {
        const status = ticket.status ?? 'open';
        const meta = STATUS_META[status] ?? STATUS_META['open'];
        const priLabel = priorityLabel(ticket.priority);

        return (
          <li
            key={ticket.id}
            className="flex items-start gap-2.5 rounded-lg bg-neutral-50 p-2.5 dark:bg-neutral-800"
          >
            <FontAwesomeIcon
              icon={status === 'blocked' ? faCircleXmark : faCircleDot}
              className={`mt-0.5 h-3 w-3 shrink-0 ${meta.iconClass}`}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <Text size="xs" weight="medium" className="truncate leading-snug">
                {ticket.title}
              </Text>
              <Text variant="muted" size="xs" className="mt-0.5">
                {teamName}
              </Text>
            </div>
            {priLabel && (
              <span
                className={`rounded border px-1.5 py-0.5 text-xs font-medium shrink-0 ${priorityClass(ticket.priority)}`}
              >
                {priLabel}
              </span>
            )}
          </li>
        );
      })}
      {hiddenCount > 0 && (
        <p className="text-center text-xs text-neutral-400 dark:text-neutral-500 pt-1">
          +{hiddenCount} more
        </p>
      )}
    </ul>
  );
};
