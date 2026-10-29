/**
 * Acting on a Redmine issue acts on the TimeHuddle ticket carrying it (#736).
 *
 * The first time someone starts a timer on a bare Redmine issue, or puts it on
 * My Board, the current team's ticket carrying it is found, or created and
 * linked, by `tickets.carryIssue`. The timer or board entry then names that
 * ticket, so what gets timed and boarded is always a TimeHuddle ticket.
 */
import { ticketApi } from '../../lib/api';

import { ticketKey, ticketRefOf } from './sources';

/** A Redmine issue was acted on with no team selected to put its ticket in. */
export class NoTeamError extends Error {
  constructor() {
    super('No team selected');
    this.name = 'NoTeamError';
  }
}

/**
 * The key to act on for row key `key`: the key of the ticket carrying it in
 * `teamId` for a Redmine issue, and `key` itself for anything else. Throws
 * `NoTeamError` for a Redmine issue with no team, and the server's refusal
 * (no access, issue gone) as an `ApiError`.
 */
export async function carriedKey(key: string, teamId: string | null): Promise<string> {
  const { sourceId, ticketId } = ticketRefOf(key);
  if (sourceId !== 'redmine') return key;
  if (!teamId) throw new NoTeamError();
  const { ticket } = await ticketApi.carryIssue(teamId, ticketId);
  return ticketKey('huddle', ticket.id);
}
