/**
 * Inline references in TimeHuddle's editors and posts: `@` for teammates and
 * `#` for tickets (mieweb/ui `ReferenceTrigger`). A pick is saved as a link —
 * `[@Ann Lee](/app/profile/<id>)`, `[TH-12: Fix login](/app/tickets/<id>)` —
 * which is how a post's mentions and tickets are read back (planItems,
 * postRefs). Search results are suggestions only: what a post carries is
 * checked against fresh data when it's sent.
 */
import { useMemo, useRef } from 'react';
import type { ReferenceOption, ReferenceTrigger } from '@mieweb/ui';
import { ticketApi } from '@lib/api';
import { useSession } from '@lib/useSession';
import { CLOSED_STATUSES } from '../tickets/sources/huddleSource';
import { useMyBoardKeys } from '../tickets/useMyBoardKeys';
import { planTicketName, profilePath, ticketPath } from './planItems';
import type { Ticket } from './types';
import type { TeamMentions } from './useTeamMentions';

/** User-facing copy, kept together for translation. */
export const REFERENCE_TEXT = {
  people: 'People',
  tickets: 'Tickets',
  onMyBoard: 'My Board',
};

/** Most tickets the `#` list shows. */
const MAX_TICKETS = 20;

const pathId = (pattern: RegExp) => (href: string) => {
  const match = pattern.exec(href);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
};

/** How a teammate is linked — without a search; enough to read and draw links. */
export const PERSON_LINKS: ReferenceTrigger = {
  kind: 'person',
  char: '@',
  label: REFERENCE_TEXT.people,
  search: () => [],
  toHref: profilePath,
  fromHref: pathId(/^\/app\/profile\/([^/?#]+)$/),
};

/** How a ticket is linked; Redmine issues (/app/tickets/redmine/…) aren't team tickets. */
export const TICKET_LINKS: ReferenceTrigger = {
  kind: 'ticket',
  char: '#',
  label: REFERENCE_TEXT.tickets,
  search: () => [],
  toHref: ticketPath,
  fromHref: pathId(/^\/app\/tickets\/(?!redmine\/)([^/?#]+)$/),
};

/** `@` teammates, from the team's roster — waited on if `@` is typed before it loads. */
export function usePersonTrigger(mentions: TeamMentions): ReferenceTrigger {
  const { roster } = mentions;
  return useMemo(
    () => ({
      ...PERSON_LINKS,
      search: async (query: string) => {
        const q = query.toLowerCase();
        return (await roster)
          .filter((person) => person.name.toLowerCase().includes(q))
          .map<ReferenceOption>((person) => ({
            kind: 'person',
            id: person.id,
            label: `@${person.name}`,
          }));
      },
    }),
    [roster],
  );
}

const updatedTime = (ticket: Ticket) => (ticket.updatedAt ? Date.parse(ticket.updatedAt) : 0);

/**
 * `#` tickets: the team's open tickets (not closed or reviewed) matching the key or title typed, the
 * ones on your My Board first, most recently updated first.
 */
export function useTicketTrigger(
  teamId: string | null | undefined,
  ticketPrefix?: string,
): ReferenceTrigger {
  const { user } = useSession();
  const { boardKeys } = useMyBoardKeys(user?.id ?? null);
  // Read at search time, so the trigger keeps its identity as data arrives.
  const latest = useRef({ teamId, boardKeys, ticketPrefix });
  latest.current = { teamId, boardKeys, ticketPrefix };
  // The team's tickets, as a request the searches wait on. Read afresh at
  // each new `#` (an empty query) — Huddle stays mounted, so a first-load
  // snapshot would miss new tickets and keep closed ones — and reused while
  // that query is typed. Keyed by team: never another team's tickets.
  const tickets = useRef<{ teamId: string; request: Promise<Ticket[]> } | null>(null);

  return useMemo(
    () => ({
      ...TICKET_LINKS,
      search: async (query: string) => {
        const { teamId: id, boardKeys: board, ticketPrefix: prefix } = latest.current;
        if (!id) return [];
        if (query === '' || tickets.current?.teamId !== id) {
          tickets.current = {
            teamId: id,
            request: ticketApi.getTickets(id, { brief: true }).catch((): Ticket[] => []),
          };
        }
        const all = await tickets.current.request;
        const q = query.toLowerCase();
        const onBoard = (ticket: Ticket) => board.has(`huddle:${ticket.id}`);
        return all
          .filter((ticket) => !CLOSED_STATUSES.has(ticket.status))
          .map((ticket) => ({ ticket, name: planTicketName(ticket, prefix) }))
          .filter(({ name }) => name.toLowerCase().includes(q))
          .sort(
            (a, b) =>
              Number(onBoard(b.ticket)) - Number(onBoard(a.ticket)) ||
              updatedTime(b.ticket) - updatedTime(a.ticket),
          )
          .slice(0, MAX_TICKETS)
          .map<ReferenceOption>(({ ticket, name }) => ({
            kind: 'ticket',
            id: ticket.id,
            label: name,
            meta: onBoard(ticket) ? REFERENCE_TEXT.onMyBoard : undefined,
          }));
      },
    }),
    [],
  );
}
