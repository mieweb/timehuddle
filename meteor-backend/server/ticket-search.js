/**
 * `tickets.search` — the tickets what was typed into the Tickets search bar
 * names, in any of the caller's teams (#736c): by ID, `@name`, pasted link or
 * words in the title. The rules live in `ticket-search-core.js`.
 */
import { Meteor } from 'meteor/meteor';

import { requireIdentity } from './auth-bridge';
import { Teams, Tickets, rawDb } from './collections';
import { optionalRedmineBaseUrl } from './redmine-client';
import { matchAssignees } from './redmine-query';
import { DEFAULT_TICKET_IDS, hostOf, ticketIdsFor } from './ticket-ids';
import {
  MAX_REF_RESULTS,
  parseTicketQuery,
  ticketAssigneeSelector,
  ticketLinkSelector,
  ticketRefSelector,
  ticketTextSelector,
} from './ticket-search-core';
import { toPublicTicket } from './tickets';

/**
 * The caller's teams, `{ id, orgId }`, and each of their orgs' ticket IDs, as
 * `ticketIdsFor` returns them.
 */
async function callerTicketIds(userId) {
  const teams = await callerTeams(userId);
  return {
    teams,
    idsByOrg: await ticketIdsFor(
      rawDb(),
      teams.map((team) => team.orgId),
    ),
  };
}

/** The caller's teams, `{ id, orgId, people }`, `people` being its members and admins. */
async function callerTeams(userId) {
  const docs = await Teams.find(
    { $or: [{ members: userId }, { admins: userId }] },
    { fields: { _id: 1, orgId: 1, members: 1, admins: 1 } },
  ).fetchAsync();
  return docs.map((team) => ({
    // Legacy teams can have string ids, as `teams.js` allows.
    id: typeof team._id === 'string' ? team._id : team._id.toHexString(),
    orgId: team.orgId ?? null,
    people: [...(team.members ?? []), ...(team.admins ?? [])],
  }));
}

/**
 * The teammates an `@name` means, as user ids: the same matching as for
 * Redmine, so `@alex` finds "Alex Kim", over everyone in the caller's teams.
 * Several matches are all kept: they are the caller's own teammates, so
 * listing each one's tickets shows nothing the caller could not see anyway.
 */
async function teammatesNamed(teams, name) {
  const ids = [...new Set(teams.flatMap((team) => team.people))];
  const users = await Meteor.users
    .find({ _id: { $in: ids } }, { fields: { 'profile.name': 1 } })
    .fetchAsync();
  const named = users.map((user) => ({ id: user._id, name: user.profile?.name ?? '' }));
  return matchAssignees(named, name).map((user) => user.id);
}

/**
 * The prefixes the caller's orgs give the Redmine server at `baseUrl`, so
 * `RM0-233` can be searched for as issue 233 there.
 */
export async function redminePrefixesFor(userId, baseUrl) {
  const host = hostOf(baseUrl);
  if (!host) return [];
  const { teams, idsByOrg } = await callerTicketIds(userId);
  const prefixes = teams.flatMap((team) =>
    ((team.orgId && idsByOrg.get(team.orgId)) || DEFAULT_TICKET_IDS).sourcePrefixes
      .filter((entry) => entry.host === host)
      .map((entry) => entry.prefix),
  );
  return [...new Set(prefixes)];
}

const findTickets = (selector) =>
  selector
    ? Tickets.find(selector, {
        sort: { createdAt: -1 },
        limit: MAX_REF_RESULTS,
        fields: { description: 0 },
      }).fetchAsync()
    : [];

/** `lists` joined in order with no ticket twice, at most `MAX_REF_RESULTS`. */
function firstOfEach(lists) {
  const seen = new Set();
  return lists
    .flat()
    .filter((doc) => {
      const id = doc._id.toHexString();
      return !seen.has(id) && seen.add(id);
    })
    .slice(0, MAX_REF_RESULTS);
}

/** The tickets one parsed query names, newest first; an exact ID first of all. */
async function searchTickets(userId, parsed) {
  const scope = {
    ...(await callerTicketIds(userId)),
    redmineHost: hostOf(optionalRedmineBaseUrl()),
  };
  switch (parsed.kind) {
    case 'id': {
      const { ref } = parsed;
      // The exact match first, then the rest of the prefix: `TH-2` before `TH-20`.
      return firstOfEach(
        await Promise.all([
          ref.name === null ? [] : findTickets(ticketRefSelector(ref, scope, { exact: true })),
          findTickets(ticketRefSelector(ref, scope)),
        ]),
      );
    }
    case 'url':
      return findTickets(ticketLinkSelector(parsed.link, scope));
    case 'assignee':
      return findTickets(
        ticketAssigneeSelector(await teammatesNamed(scope.teams, parsed.name), scope.teams),
      );
    default:
      return findTickets(ticketTextSelector(parsed.words, scope.teams));
  }
}

Meteor.methods({
  /**
   * The live tickets `query` names, at most 25, without descriptions:
   *
   *   - an ID or ID prefix (`TH-12`, `TH-`, `RMX-1`, `pulse-223`, `223`), the
   *     exact match first
   *   - `@name`, tickets assigned to that teammate
   *   - a pasted issue link, tickets carrying or linking to it
   *   - words, tickets with every one of them in the title
   *
   * Newest first. `kind` says how the query was read, for the dropdown to
   * explain an empty result; null when it was not worth asking.
   */
  async 'tickets.search'({ query } = {}) {
    const { userId } = await requireIdentity(this);
    if (typeof query !== 'string') {
      throw new Meteor.Error('bad-request', 'A search query is required.');
    }
    const parsed = parseTicketQuery(query);
    if (!parsed) return { kind: null, tickets: [] };
    const tickets = await searchTickets(userId, parsed);
    return { kind: parsed.kind, tickets: tickets.map(toPublicTicket) };
  },
});
