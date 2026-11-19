/**
 * useTicketMentionOptions — a team's open tickets as `@` suggestions for a
 * rich composer. Choosing one writes the ticket into the text as a link to its
 * page (`RichEditor` inserts an option with an `href` as a link), which is how
 * a plan's tickets are read back out of it (planItems).
 */
import { useEffect, useMemo, useState } from 'react';
import type { MentionOption } from '@mieweb/ui/kerebron';
import { fetchTeamTickets } from './api';
import { planTicketName, ticketPath } from './planItems';
import type { Ticket } from './types';

/** User-facing copy, kept together for translation. */
const TICKET_OPTION_TEXT = { kind: 'Ticket' };

export function useTicketMentionOptions(
  teamId: string | null | undefined,
  ticketPrefix?: string,
): MentionOption[] {
  const [loaded, setLoaded] = useState<{ teamId: string; tickets: Ticket[] } | null>(null);

  useEffect(() => {
    if (!teamId) return;
    let cancelled = false;
    fetchTeamTickets(teamId)
      .then((tickets) => {
        if (!cancelled) setLoaded({ teamId, tickets });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ teamId, tickets: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  return useMemo(
    () =>
      // Keyed by team, as useTeamMentions is: never another team's tickets.
      (teamId && loaded?.teamId === teamId ? loaded.tickets : [])
        .filter((ticket) => ticket.status !== 'closed')
        .map((ticket) => ({
          id: `ticket:${ticket.id}`,
          label: planTicketName(ticket, ticketPrefix),
          href: ticketPath(ticket.id),
          meta: TICKET_OPTION_TEXT.kind,
        })),
    [teamId, loaded, ticketPrefix],
  );
}
