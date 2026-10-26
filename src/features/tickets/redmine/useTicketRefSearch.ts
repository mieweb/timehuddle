/**
 * The tickets an ID in the search bar names, in any of the user's teams
 * (#736c): `THX-12`, `RM0-233`, `timehuddle-223`, or a bare `223`.
 *
 * Asked beside the Redmine search rather than through it: Redmine being down,
 * or not linked at all, must not hide a ticket TimeHuddle already has. Same
 * timing as that search, and only the latest answer is kept. A failed lookup
 * shows no tickets; the next keystroke asks again.
 */
import { useEffect, useRef, useState } from 'react';

import { ticketApi, type Ticket } from '../../../lib/api';

import { SEARCH_DEBOUNCE_MS, isCompleteQuery, shouldSearchServer } from './suggestions';

const NONE: Ticket[] = [];

export function useTicketRefSearch(userId: string | null, query: string): Ticket[] {
  const [found, setFound] = useState<{ query: string; tickets: Ticket[] }>({
    query: '',
    tickets: NONE,
  });
  const seq = useRef(0);
  const text = query.trim();

  useEffect(() => {
    const mine = ++seq.current; // any answer still in flight is now stale
    if (!userId || !shouldSearchServer(text)) return;
    const settle = (tickets: Ticket[]) => {
      if (mine === seq.current) setFound({ query: text, tickets });
    };
    const timer = window.setTimeout(
      () => void ticketApi.findByRef(text).then(settle, () => settle(NONE)),
      isCompleteQuery(text) ? 0 : SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [userId, text]);

  return found.query === text ? found.tickets : NONE;
}
