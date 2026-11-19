/**
 * useBoardTicketMentionOptions — the signed-in user's My Board tickets in a
 * team, most recently updated first, as `@` suggestions for a composer.
 * Choosing one writes the ticket into the text as a link to its page, which is
 * how a post's tickets are read back out of it (planItems).
 */
import { useEffect, useMemo, useState } from 'react';
import type { MentionOption } from '@mieweb/ui/kerebron';
import { useSession } from '@lib/useSession';
import { useMyBoardKeys } from '../tickets/useMyBoardKeys';
import { fetchTeamTickets } from './api';
import { planTicketName, ticketPath } from './planItems';
import type { Ticket } from './types';

/** User-facing copy, kept together for translation. */
const TICKET_OPTION_TEXT = { kind: 'Ticket' };

const updatedTime = (ticket: Ticket) => (ticket.updatedAt ? Date.parse(ticket.updatedAt) : 0);

export function useBoardTicketMentionOptions(
  teamId: string | null | undefined,
  ticketPrefix?: string,
): MentionOption[] {
  const { user } = useSession();
  const { boardKeys } = useMyBoardKeys(user?.id ?? null);
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
        .filter((ticket) => ticket.status !== 'closed' && boardKeys.has(`huddle:${ticket.id}`))
        .sort((a, b) => updatedTime(b) - updatedTime(a))
        .map((ticket) => ({
          id: `ticket:${ticket.id}`,
          label: planTicketName(ticket, ticketPrefix),
          href: ticketPath(ticket.id),
          meta: TICKET_OPTION_TEXT.kind,
        })),
    [teamId, loaded, ticketPrefix, boardKeys],
  );
}
