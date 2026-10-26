/**
 * `tickets.findByRef` — the tickets an ID typed into the Tickets search bar
 * names, in any of the caller's teams (#736c). The rules live in
 * `ticket-search-core.js`.
 */
import { Meteor } from 'meteor/meteor';

import { requireIdentity } from './auth-bridge';
import { Teams, Tickets, rawDb } from './collections';
import { optionalRedmineBaseUrl } from './redmine-client';
import { DEFAULT_TICKET_IDS, hostOf, ticketIdsFor } from './ticket-ids';
import { MAX_REF_RESULTS, parseTicketRef, ticketRefSelector } from './ticket-search-core';
import { toPublicTicket } from './tickets';

/**
 * The caller's teams, `{ id, orgId }`, and each of their orgs' ticket IDs, as
 * `ticketIdsFor` returns them.
 */
async function callerTicketIds(userId) {
  const docs = await Teams.find(
    { $or: [{ members: userId }, { admins: userId }] },
    { fields: { _id: 1, orgId: 1 } },
  ).fetchAsync();
  const teams = docs.map((team) => ({ id: team._id.toHexString(), orgId: team.orgId ?? null }));
  return { teams, idsByOrg: await ticketIdsFor(rawDb(), teams.map((team) => team.orgId)) };
}

/**
 * The prefixes the caller's orgs give the Redmine server at `baseUrl`, so
 * `RM0-233` can be searched for as issue 233 there.
 */
export async function redminePrefixesFor(userId, baseUrl) {
  const host = hostOf(baseUrl);
  if (!host) return [];
  const { teams, idsByOrg } = await callerTicketIds(userId);
  const prefixes = teams.flatMap(
    (team) =>
      ((team.orgId && idsByOrg.get(team.orgId)) || DEFAULT_TICKET_IDS).sourcePrefixes
        .filter((entry) => entry.host === host)
        .map((entry) => entry.prefix),
  );
  return [...new Set(prefixes)];
}

Meteor.methods({
  /**
   * The live tickets `query` names by ID or ID prefix (`TH-`, `TH-1`), an
   * exact match first and then newest first, at most 25, without
   * descriptions. Words, `@name` and links name none: `{ tickets: [] }`.
   */
  async 'tickets.findByRef'({ query } = {}) {
    const { userId } = await requireIdentity(this);
    if (typeof query !== 'string') {
      throw new Meteor.Error('bad-request', 'A search query is required.');
    }
    const ref = parseTicketRef(query);
    if (!ref) return { tickets: [] };

    const scope = {
      ...(await callerTicketIds(userId)),
      redmineHost: hostOf(optionalRedmineBaseUrl()),
    };
    const find = (selector) =>
      selector
        ? Tickets.find(selector, {
            sort: { createdAt: -1 },
            limit: MAX_REF_RESULTS,
            fields: { description: 0 },
          }).fetchAsync()
        : [];
    // The exact match first, then the rest of the prefix: `TH-2` before `TH-20`.
    const [exact, started] = await Promise.all([
      ref.name === null ? [] : find(ticketRefSelector(ref, scope, { exact: true })),
      find(ticketRefSelector(ref, scope)),
    ]);
    const seen = new Set();
    const tickets = [...exact, ...started].filter((doc) => {
      const id = doc._id.toHexString();
      return !seen.has(id) && seen.add(id);
    });
    return { tickets: tickets.slice(0, MAX_REF_RESULTS).map(toPublicTicket) };
  },
});
