/**
 * GitHub in the Tickets search bar (#873), beside `redmine.issues.search`.
 *
 * Asked with the member's own connection, through what GitHub's definition names
 * (`can.search`, `can.assigned`). With no text it answers what's assigned to them;
 * with text, what the text finds. Slow or failing, it comes back `failed`, and
 * `rateLimited` too when that's why, so the rest of the search bar isn't held up.
 * Results are slim, with no body or comments, and nothing is stored. The query
 * is never logged: a user may type a patient's name.
 *
 * The answer is a list of servers, so another source joins without a new shape.
 */
import { github } from '@timehuddle/ticket-sources';
import { Meteor } from 'meteor/meteor';

import { requireIdentity } from './auth-bridge';
import { GithubLinks, Teams, Tickets } from './collections';
import { GITHUB_HOST } from './github-client';
import { createRateLimiter } from './rate-limit';
import { enforceRedmineLimit } from './redmine';
import { driverFor } from './sources/registry';

const searchLimiter = createRateLimiter({ limit: 60, windowMs: 60 * 1000 });
const SEARCH_MS = 8000;
const GITHUB_SERVER = { host: GITHUB_HOST, prefix: '', type: github.kind };

/** Rejects when `work` takes longer than `ms`. */
function withinTime(work, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timed out')), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

async function searchGithub(userId, query) {
  try {
    const driver = driverFor(github.kind);
    const session = await driver.open(userId);
    const { search, assigned } = driver.definition.can;
    // No text: what's assigned to the member.
    const work = query
      ? driver.hooks[search.hook](query, session.ctx)
      : driver.hooks[assigned.hook](session.ctx);
    return { ...GITHUB_SERVER, failed: false, issues: await withinTime(work, SEARCH_MS) };
  } catch (err) {
    // A rate limit is said as one: GitHub is fine, it's asked too often.
    return {
      ...GITHUB_SERVER,
      failed: true,
      ...(err?.rateLimited ? { rateLimited: true } : {}),
      issues: [],
    };
  }
}

const idText = (id) => (typeof id?.toHexString === 'function' ? id.toHexString() : String(id));

/** Marks each issue with the tickets carrying its address in the member's teams, so a result can open one. */
async function withTickets(userId, answer) {
  const urls = answer.issues.map((issue) => issue.url);
  if (!urls.length) return answer;
  const teams = await Teams.find(
    { $or: [{ members: userId }, { admins: userId }] },
    { fields: { _id: 1 } },
  ).fetchAsync();
  const carriers = await Tickets.find(
    {
      teamId: { $in: teams.map((team) => idText(team._id)) },
      status: { $ne: 'deleted' },
      github: { $in: urls },
      linkIsIssue: { $ne: false },
    },
    { fields: { teamId: 1, github: 1 } },
  ).fetchAsync();
  return {
    ...answer,
    issues: answer.issues.map((issue) => ({
      ...issue,
      tickets: carriers
        .filter((ticket) => ticket.github === issue.url)
        .map((ticket) => ({ id: idText(ticket._id), teamId: ticket.teamId })),
    })),
  };
}

Meteor.methods({
  /** What `query` finds on GitHub, or what's assigned with none. See the file comment. */
  async 'sources.search'({ query } = {}) {
    const { userId } = await requireIdentity(this);
    if (typeof query !== 'string') {
      throw new Meteor.Error('bad-request', 'A search query is required.');
    }
    const connected = await GithubLinks.findOneAsync(
      { userId, rejectedAt: { $exists: false } },
      { fields: { _id: 1 } },
    );
    if (!connected) return { servers: [] };
    enforceRedmineLimit(searchLimiter, userId);
    return { servers: [await withTickets(userId, await searchGithub(userId, query.trim()))] };
  },
});
