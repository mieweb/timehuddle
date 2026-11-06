/**
 * The live status and assignees of the issues tickets carry from servers other
 * than the member's main Redmine (#734), for the Tickets table's rows. The
 * main server's come with `redmine.issues.relevant`, as before.
 *
 * Each server is read through its source's definition (`readSummary`) with the
 * member's own key for it, so a new source's tickets show their live status
 * with no code here. An issue the member can't open there, or a server they
 * haven't connected, is left out: the row keeps the ticket's own status.
 */
import { Meteor } from 'meteor/meteor';

import { requireIdentity } from './auth-bridge';
import { Teams, Tickets } from './collections';
import { createRateLimiter } from './rate-limit';
import { enforceRedmineLimit } from './redmine';
import { createUserTtlCache } from './redmine-cache';
import { mapInChunks } from './redmine-client';
import { mainHost } from './source-accounts';
import { readSummary } from './sources/engine';
import { driverFor } from './sources/registry';

/** How many of one server's issues are read for the table: a row past this keeps its own status. */
export const MAX_LINKED_PER_SERVER = 50;
const READS_AT_ONCE = 5;

const linkedLimiter = createRateLimiter({ limit: 30, windowMs: 60 * 1000 });
const linkedCache = createUserTtlCache(90 * 1000);

/** The linked issues `userId`'s tickets carry, by `source` and host, leaving out the main server's. */
async function linkedByServer(userId) {
  const teams = await Teams.find(
    { $or: [{ members: userId }, { admins: userId }] },
    { fields: { _id: 1 } },
  ).fetchAsync();
  if (!teams.length) return new Map();
  const main = await mainHost(userId);
  const tickets = await Tickets.find(
    {
      teamId: { $in: teams.map((team) => team._id.toHexString()) },
      status: { $ne: 'deleted' },
      'linkedIssue.host': { $type: 'string', ...(main ? { $ne: main } : {}) },
    },
    { fields: { linkedIssue: 1 } },
  ).fetchAsync();
  const byServer = new Map();
  for (const { linkedIssue } of tickets) {
    const key = `${linkedIssue.source}|${linkedIssue.host}`;
    if (!byServer.has(key)) {
      byServer.set(key, { source: linkedIssue.source, host: linkedIssue.host, ids: new Set() });
    }
    byServer.get(key).ids.add(String(linkedIssue.id));
  }
  return byServer;
}

/** One server's issues as the member sees them there; none when they can't be read. */
async function readServer(userId, { source, host, ids }) {
  const driver = driverFor(source);
  if (!driver) return [];
  let session;
  try {
    session = await driver.open(userId, host);
  } catch {
    return [];
  }
  const read = await mapInChunks([...ids].slice(0, MAX_LINKED_PER_SERVER), READS_AT_ONCE, (id) =>
    readSummary({
      definition: driver.definition,
      ref: { key: id },
      request: session.request,
      hooks: driver.hooks,
      ctx: session.ctx,
    }).then(
      (summary) => (summary ? { source, host, id, ...summary } : null),
      () => null,
    ),
  );
  return read.filter(Boolean);
}

Meteor.methods({
  /**
   * `{ issues }`: each `{ source, host, id, status, assignees }`, for the issues
   * the caller's tickets carry from servers other than their main Redmine.
   */
  async 'sources.linkedIssues'() {
    const { userId } = await requireIdentity(this);
    return linkedCache.get(userId, 'linked', async () => {
      enforceRedmineLimit(linkedLimiter, userId);
      const servers = [...(await linkedByServer(userId)).values()];
      const issues = await Promise.all(servers.map((server) => readServer(userId, server)));
      return { issues: issues.flat() };
    });
  },
});
