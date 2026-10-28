/**
 * The tickets the search bar's text names, in any of the user's teams
 * (#736c): by ID or ID prefix (`THX-12`, `TH-`, `pulse-2`), `@name`, a pasted
 * link, or words in the title. See `tickets.search`.
 *
 * Asked beside the Redmine search rather than through it: Redmine being down,
 * or not linked at all, must not hide a ticket TimeHuddle already has. Same
 * timing as that search, and only the latest answer is kept. A failed lookup
 * shows no tickets; the next keystroke asks again.
 */
import { useEffect, useRef, useState } from 'react';

import { ticketApi, type Ticket, type TicketSearchKind } from '../../../lib/api';

import { SEARCH_DEBOUNCE_MS, isCompleteQuery, shouldSearchServer } from './suggestions';

const NONE: Ticket[] = [];

export interface TicketSearch {
  tickets: Ticket[];
  /** The answer for the current text is in (an empty list included). */
  settled: boolean;
  /** How the server read the text, once settled. */
  kind: TicketSearchKind | null;
}

export function useTicketSearch(userId: string | null, query: string): TicketSearch {
  const [found, setFound] = useState<{
    query: string;
    kind: TicketSearchKind | null;
    tickets: Ticket[];
  }>({ query: '', kind: null, tickets: NONE });
  const seq = useRef(0);
  const text = query.trim();

  useEffect(() => {
    const mine = ++seq.current; // any answer still in flight is now stale
    if (!userId || !shouldSearchServer(text)) return;
    const settle = (kind: TicketSearchKind | null, tickets: Ticket[]) => {
      if (mine === seq.current) setFound({ query: text, kind, tickets });
    };
    const timer = window.setTimeout(
      () =>
        void ticketApi.search(text).then(
          (result) => settle(result.kind, result.tickets),
          () => settle(null, NONE),
        ),
      isCompleteQuery(text) ? 0 : SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [userId, text]);

  return found.query === text
    ? { tickets: found.tickets, settled: true, kind: found.kind }
    : { tickets: NONE, settled: false, kind: null };
}
