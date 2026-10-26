/**
 * useTicketSelection — the tickets a composer attaches to its next post. The
 * Clock page and the Huddle inbox both stage several; picking one adds it,
 * and picking one already there is a no-op. Each keeps the title it was
 * picked (or seeded) with so its chip can name it; only the ids are posted.
 */
import { useCallback, useMemo, useState } from 'react';

/** A staged ticket. `title` is null when it can't be resolved (e.g. deleted). */
export type TicketRef = { id: string; title: string | null };

export function useTicketSelection() {
  const [tickets, setTickets] = useState<TicketRef[]>([]);
  const ticketIds = useMemo(() => tickets.map((t) => t.id), [tickets]);
  const addTicket = useCallback(
    (ticket: TicketRef) =>
      setTickets((prev) => (prev.some((t) => t.id === ticket.id) ? prev : [...prev, ticket])),
    [],
  );
  const removeTicket = useCallback(
    (ticketId: string) => setTickets((prev) => prev.filter((t) => t.id !== ticketId)),
    [],
  );
  return { tickets, ticketIds, setTickets, addTicket, removeTicket };
}
