/**
 * What a post's text refers to — the teammates it @mentions and the team's
 * tickets it links — resolved against the team's data read fresh at send.
 * A lookup that fails throws, so the send fails and can be retried instead of
 * saving no mentions or dropping ticket links. Each lookup runs only when it's
 * needed, and tickets are read without their descriptions.
 */
import { ticketApi } from '@lib/api';
import { fetchTeamMembers } from './api';
import { profileIdsInText, teamTicketIdsInText, ticketIdsInText } from './planItems';
import type { TeamMember } from './types';
import { detectMentions } from './useTeamMentions';

export interface TeamRefs {
  members: TeamMember[];
  ticketIds: ReadonlySet<string>;
}

/** Which lookups `text` needs: people when it has an `@` or a profile link, tickets when it links one. */
export function refsNeeded(text: string): { members: boolean; tickets: boolean } {
  return {
    members: text.includes('@') || profileIdsInText(text).length > 0,
    tickets: ticketIdsInText(text).length > 0,
  };
}

/** Whether `refs` was looked up for everything `needs` asks. */
export function refsCover(
  looked: { members: boolean; tickets: boolean },
  needs: { members: boolean; tickets: boolean },
): boolean {
  return (looked.members || !needs.members) && (looked.tickets || !needs.tickets);
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

/**
 * The mentioned user ids and linked ticket ids of `text`, by `refs`. A
 * mention picked from the `@` list is a profile link, so it names its person
 * exactly even when teammates share a first name; a typed `@Name` is matched
 * by first name. Either way only the team's members count — the server
 * refuses a post naming an unknown user.
 */
export function postRefsIn(text: string, refs: TeamRefs) {
  const memberIds = new Set(refs.members.map((member) => member.id));
  const linked = profileIdsInText(text).filter((id) => memberIds.has(id));
  return {
    mentions: [...new Set([...linked, ...detectMentions(text, refs.members)])],
    ticketIds: teamTicketIdsInText(text, refs.ticketIds),
  };
}
