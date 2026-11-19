/**
 * What a post's text refers to — the teammates it @mentions and the team's
 * tickets it links — resolved against the team's data read fresh at send.
 * A lookup that fails throws, so the send fails and can be retried instead of
 * saving no mentions or dropping ticket links. Each lookup runs only when it's
 * needed, and tickets are read without their descriptions.
 */
import { ticketApi } from '@lib/api';
import { fetchTeamMembers } from './api';
import { teamTicketIdsInText, ticketIdsInText } from './planItems';
import type { TeamMember } from './types';
import { detectMentions } from './useTeamMentions';

export interface TeamRefs {
  members: TeamMember[];
  ticketIds: ReadonlySet<string>;
}

/** Which lookups `text` needs: people when it has an `@`, tickets when it links one. */
export function refsNeeded(text: string): { members: boolean; tickets: boolean } {
  return { members: text.includes('@'), tickets: ticketIdsInText(text).length > 0 };
}

export async function fetchTeamRefs(
  teamId: string,
  needs: { members: boolean; tickets: boolean },
): Promise<TeamRefs> {
  const [members, tickets] = await Promise.all([
    needs.members ? fetchTeamMembers(teamId) : [],
    needs.tickets ? ticketApi.getTickets(teamId, { brief: true }) : [],
  ]);
  return { members, ticketIds: new Set(tickets.map((ticket) => ticket.id)) };
}

/** The mentioned user ids and linked ticket ids of `text`, by `refs`. */
export function postRefsIn(text: string, refs: TeamRefs) {
  return {
    mentions: detectMentions(text, refs.members),
    ticketIds: teamTicketIdsInText(text, refs.ticketIds),
  };
}
