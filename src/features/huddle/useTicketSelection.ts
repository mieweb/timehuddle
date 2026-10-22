/**
 * useTicketSelection — the tickets a composer attaches to its next post. The
 * Clock page and the Huddle inbox both stage several; picking one adds it,
 * and picking one already there is a no-op.
 */
import { useCallback, useState } from 'react';

export function useTicketSelection() {
  const [ticketIds, setTicketIds] = useState<string[]>([]);
  const addTicket = useCallback(
    (ticketId: string) =>
      setTicketIds((prev) => (prev.includes(ticketId) ? prev : [...prev, ticketId])),
    [],
  );
  const removeTicket = useCallback(
    (ticketId: string) => setTicketIds((prev) => prev.filter((id) => id !== ticketId)),
    [],
  );
  return { ticketIds, setTicketIds, addTicket, removeTicket };
}
