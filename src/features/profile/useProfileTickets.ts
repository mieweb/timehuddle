/**
 * useProfileTickets — Reusable hook for fetching and filtering a user's active tickets.
 *
 * Used by both ProfileWorkSnapshot and org chart member lightbox.
 */
import { useEffect, useMemo, useState } from 'react';

import { ticketApi, type Ticket } from '../../lib/api';

const DONE_STATUSES = new Set(['closed', 'reviewed', 'deleted']);
const STATUS_ORDER = ['blocked', 'in-progress', 'open'];

interface Team {
  id: string;
  name: string;
}

interface TicketWithTeam {
  ticket: Ticket;
  teamName: string;
}

export const useProfileTickets = (userId: string, teams: Team[]) => {
  const [allTickets, setAllTickets] = useState<TicketWithTeam[]>([]);
  const [loading, setLoading] = useState(true);

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

  // Group by status for section headings
  const groups = useMemo(() => {
    const map = new Map<string, TicketWithTeam[]>();
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

  return {
    activeTickets,
    groups,
    loading,
  };
};
