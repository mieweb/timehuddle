/**
 * Searching every other server a member has connected (#734 step 8), from the
 * Tickets search bar. Beside `redmine.issues.search`, which asks the main one.
 *
 * Each server is asked with the member's own key for it, through what its source
 * definition names (`can.search`), so a new source joins with its definition.
 * One slow or failing server doesn't hold up the others: it comes back `failed`.
 * Results are slim, with no description, history or custom fields, and nothing
 * is stored. The query is never logged: a user may type a patient's name.
 */
import { Meteor } from 'meteor/meteor';

import { requireIdentity } from './auth-bridge';
import { RedmineLinks, Teams, Tickets } from './collections';
import { createRateLimiter } from './rate-limit';
import { enforceRedmineLimit } from './redmine';
import { mainHost, registeredServers } from './source-accounts';
import { driverFor } from './sources/registry';

const searchLimiter = createRateLimiter({ limit: 60, windowMs: 60 * 1000 });
const SERVER_SEARCH_MS = 8000;

/** The registered servers, besides the main one, the member holds a working key for and can search. */
async function searchableServers(userId) {
  const [servers, main, links] = await Promise.all([
    registeredServers(userId),
    mainHost(userId),
    RedmineLinks.find(
      { userId, host: { $type: 'string' }, rejectedAt: { $exists: false } },
      { fields: { host: 1 } },
    ).fetchAsync(),
  ]);
  const connected = new Set(links.map((link) => link.host));
  return servers.filter(
    (server) =>
      server.host !== main &&
      connected.has(server.host) &&
      driverFor(server.type)?.definition.can.search?.hook,
  );
}

/** Rejects when `work` takes longer than `ms`. */
function withinTime(work, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timed out')), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

async function searchServer(userId, server, query) {
  const base = { host: server.host, prefix: server.prefix, type: server.type };
  try {
    const driver = driverFor(server.type);
    const session = await driver.open(userId, server.host);
    const search = driver.hooks[driver.definition.can.search.hook];
    const issues = await withinTime(search(query, session.ctx), SERVER_SEARCH_MS);
    return {
      ...base,
      failed: false,
      issues: issues.map((issue) => ({ ...issue, url: session.urlOf({ key: String(issue.id) }) })),
    };
  } catch {
    return { ...base, failed: true, issues: [] };
  }
}

const idText = (id) => (typeof id?.toHexString === 'function' ? id.toHexString() : String(id));

/** Marks each issue with the tickets carrying it in the member's teams, so a result can open one. */
async function withTickets(userId, answers) {
  const issueIds = answers.flatMap((answer) => answer.issues.map((issue) => String(issue.id)));
  if (!issueIds.length) return answers;
  const teams = await Teams.find(
    { $or: [{ members: userId }, { admins: userId }] },
    { fields: { _id: 1 } },
  ).fetchAsync();
  const carriers = await Tickets.find(
    {
      teamId: { $in: teams.map((team) => idText(team._id)) },
      'linkedIssue.host': { $in: answers.map((answer) => answer.host) },
      'linkedIssue.id': { $in: issueIds },
      status: { $ne: 'deleted' },
    },
    { fields: { teamId: 1, linkedIssue: 1 } },
  ).fetchAsync();
  return answers.map((answer) => ({
    ...answer,
    issues: answer.issues.map((issue) => ({
      ...issue,
      tickets: carriers
        .filter(
          ({ linkedIssue }) =>
            linkedIssue.host === answer.host && linkedIssue.id === String(issue.id),
        )
        .map((ticket) => ({ id: idText(ticket._id), teamId: ticket.teamId })),
    })),
  }));
}

Meteor.methods({
  /** What `query` finds on each other connected server. See the file comment. */
  async 'sources.search'({ query } = {}) {
    const { userId } = await requireIdentity(this);
    if (typeof query !== 'string') {
      throw new Meteor.Error('bad-request', 'A search query is required.');
    }
    const text = query.trim();
    if (!text) return { servers: [] };
    enforceRedmineLimit(searchLimiter, userId);
    const servers = await searchableServers(userId);
    const answers = await Promise.all(
      servers.map((server) => searchServer(userId, server, text)),
    );
    return { servers: await withTickets(userId, answers) };
  },
});
