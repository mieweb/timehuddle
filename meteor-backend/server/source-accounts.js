/**
 * A member's accounts on the other servers their org registered (#734 step 7):
 * one row in `redmine_links` per server, with its `host` and `baseUrl`, beside
 * their main link (redmine-account.js). The engine reads an issue on one of
 * those servers with the member's own key for it.
 *
 * Only Redmine servers for now, the one type an owner can register. Settings
 * → Sources calls these; the main link keeps `redmine.connect`.
 */
import { Meteor } from 'meteor/meteor';

import { requireIdentity } from './auth-bridge';
import { DUPLICATE_KEY_ERROR_CODE, RedmineLinks, Teams, rawDb } from './collections';
import { createNotification } from './notify-core';
import { getAccessibleOrgIds } from './org-helpers';
import { enforceRedmineLimit, toRedmineMeteorError } from './redmine';
import { bustUserCaches } from './redmine-cache';
import { GITHUB_HOST, githubConfigured, githubRequest, revokeGithubToken } from './github-client';
import { findRedmineAccount, keyOwnerOf, mainLinkOf, requireRedmineAccount } from './redmine-account';
import { getCurrentUser, linkedRedmineBaseUrl, optionalRedmineBaseUrl } from './redmine-client';
import { encryptSecret, envKey } from './redmine-crypto';
import { createRateLimiter } from './rate-limit';
import { hostOf, ticketIdsFor } from './ticket-ids';

const connectLimiter = createRateLimiter({ limit: 30, windowMs: 60 * 1000 });

/** Every server `userId`'s orgs registered, each host once. */
export async function registeredServers(userId) {
  const db = rawDb();
  const [orgIds, teams, user] = await Promise.all([
    getAccessibleOrgIds(userId),
    Teams.find({ $or: [{ members: userId }, { admins: userId }] }, { fields: { orgId: 1 } }).fetchAsync(),
    db.collection('users').findOne({ _id: String(userId) }, { projection: { blocked: 1 } }),
  ]);
  const blockedOrgIds = new Set((user?.blocked ?? []).map((entry) => entry.orgId));
  const idsByOrg = await ticketIdsFor(
    db,
    [...orgIds, ...teams.map((team) => team.orgId).filter(Boolean)].filter(
      (id) => !blockedOrgIds.has(id),
    ),
  );
  const byHost = new Map();
  for (const { sourcePrefixes } of idsByOrg.values()) {
    for (const server of sourcePrefixes) {
      if (!byHost.has(server.host)) byHost.set(server.host, server);
    }
  }
  return [...byHost.values()];
}

/** The server at `address` if one of `userId`'s orgs registered it, else null. */
async function registeredServer(userId, address) {
  const host = hostOf(address);
  if (!host) return null;
  return (await registeredServers(userId)).find((server) => server.host === host) ?? null;
}

/**
 * Remove `userId`'s keys for servers none of their orgs list any more, of
 * `hosts` when given; returns the hosts removed. A key follows the member's
 * access: once no org of theirs registers a server, its key goes. GitHub and
 * the main server aren't registered by orgs, and are never touched here.
 */
async function removeUnlistedKeys(userId, hosts) {
  const links = await RedmineLinks.find(
    { userId, host: hosts ? { $in: hosts } : { $type: 'string', $ne: GITHUB_HOST } },
    { fields: { host: 1 } },
  ).fetchAsync();
  if (!links.length) return [];
  const listed = new Set((await registeredServers(userId)).map((server) => server.host));
  const removed = [];
  for (const link of links) {
    if (link.host === GITHUB_HOST || listed.has(link.host)) continue;
    await RedmineLinks.removeAsync({ _id: link._id, host: link.host });
    removed.push(link.host);
  }
  if (removed.length) bustUserCaches(userId);
  return removed;
}

const KEY_REMOVED_TITLE = 'Source server removed';
const KEYS_SETTINGS = { type: 'source-server-removed', url: '/app/settings?section=integrations' };

/**
 * After an owner drops servers from their org's list (`orgs.setSourcePrefixes`),
 * remove each member's key for a dropped server, and tell them so. A member
 * whose other org still registers that server keeps theirs.
 */
export async function removeKeysForDroppedServers(orgName, droppedHosts) {
  if (!droppedHosts.length) return;
  const userIds = await RedmineLinks.rawCollection().distinct('userId', {
    host: { $in: droppedHosts },
  });
  for (const userId of userIds) {
    for (const host of await removeUnlistedKeys(userId, droppedHosts)) {
      await createNotification({
        userId,
        title: KEY_REMOVED_TITLE,
        body: `The source server ${host} was deleted and your API key for it was removed by ${orgName}.`,
        data: KEYS_SETTINGS,
      });
    }
  }
}

/**
 * After `userIds` leave an org or team, or are blocked from one, remove their
 * keys for servers no org of theirs lists now, and tell them so.
 */
export async function removeKeysAfterLeaving(userIds) {
  for (const userId of userIds) {
    for (const host of await removeUnlistedKeys(userId)) {
      await createNotification({
        userId,
        title: KEY_REMOVED_TITLE,
        body: `Your API key for the source server ${host} was removed, as you're no longer in an organization that uses it.`,
        data: KEYS_SETTINGS,
      });
    }
  }
}

/** The host `userId`'s main link talks to: the deployment's Redmine unless they linked elsewhere. */
export async function mainHost(userId) {
  const main = await RedmineLinks.findOneAsync(mainLinkOf(userId), { fields: { baseUrl: 1 } });
  return hostOf(linkedRedmineBaseUrl(main?.baseUrl) ?? optionalRedmineBaseUrl());
}

Meteor.methods({
  /**
   * The servers the caller's orgs registered, each with their connection to it.
   * Never includes a key. `main` is the server connected through `redmine.connect`.
   */
  async 'sources.list'() {
    const { userId } = await requireIdentity(this);
    const [servers, main, links] = await Promise.all([
      registeredServers(userId),
      mainHost(userId),
      RedmineLinks.find({ userId }, { fields: { host: 1, baseUrl: 1, rejectedAt: 1, redmineLogin: 1 } }).fetchAsync(),
    ]);
    const linkOn = (host) =>
      links.find((link) => (link.host ? link.host === host : host === main));
    const githubLink = linkOn(GITHUB_HOST);
    return {
      // Built in for every member, connected in one click rather than with a key.
      github: {
        host: GITHUB_HOST,
        configured: githubConfigured(),
        connected: Boolean(githubLink && !githubLink.rejectedAt),
        rejected: Boolean(githubLink?.rejectedAt),
        login: githubLink?.redmineLogin ?? null,
      },
      servers: servers.map(({ host, baseUrl, prefix, type }) => {
        const link = linkOn(host);
        return {
          host,
          baseUrl,
          prefix,
          type,
          main: host === main,
          connected: Boolean(link && !link.rejectedAt),
          rejected: Boolean(link?.rejectedAt),
          login: link?.redmineLogin ?? null,
        };
      }),
    };
  },

  /** Ask `server` whether the caller's saved key still works. A rejected key is marked as such. */
  async 'sources.check'({ server } = {}) {
    const { userId } = await requireIdentity(this);
    enforceRedmineLimit(connectLimiter, userId);
    const host = hostOf(server);
    if (!host) throw new Meteor.Error('bad-request', 'A server address is required.');
    const account = await requireRedmineAccount(userId, host);
    try {
      const user =
        host === GITHUB_HOST
          ? await githubRequest('/user', account)
          : await getCurrentUser(account);
      return { host, connected: true, login: user?.login ?? null };
    } catch (err) {
      throw toRedmineMeteorError(err);
    }
  },

  /**
   * Connect the caller to `server`, a registered server's address, with their
   * own `apiKey`. Validated with Redmine first; reconnecting replaces the key
   * and clears a rejected one's mark. The main server goes through
   * `redmine.connect`, from the same list.
   */
  async 'sources.connect'({ server, apiKey } = {}) {
    const { userId } = await requireIdentity(this);
    enforceRedmineLimit(connectLimiter, userId);
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Meteor.Error('bad-request', 'An API key is required.');
    }
    const key = apiKey.trim();
    const entry = await registeredServer(userId, server);
    if (!entry) {
      throw new Meteor.Error('not-found', 'No organization of yours registered that server.');
    }
    if (entry.host === (await mainHost(userId))) {
      throw new Meteor.Error('main-server', 'Connect this server through its own row in Settings → Sources.');
    }

    let user;
    try {
      user = await getCurrentUser({ userId, apiKey: key, baseUrl: entry.baseUrl });
    } catch (err) {
      if (err?.status === 401 || err?.status === 403) {
        throw new Meteor.Error('invalid-key', 'That API key was rejected by the server.');
      }
      throw new Meteor.Error('unreachable', `Could not reach ${entry.host}.`);
    }
    if (!user) throw new Meteor.Error('invalid-key', 'That API key was rejected by the server.');

    const selector = { userId, host: entry.host };
    const update = {
      $set: {
        ...selector,
        baseUrl: entry.baseUrl,
        redmineUserId: user.id,
        redmineLogin: user.login,
        firstname: user.firstname ?? '',
        lastname: user.lastname ?? '',
        mail: user.mail ?? '',
        apiKey: encryptSecret(key, envKey(), keyOwnerOf(selector)),
        linkedAt: new Date(),
      },
      $unset: { rejectedAt: '' },
    };
    try {
      await RedmineLinks.upsertAsync(selector, update);
    } catch (err) {
      // Lost a concurrent first insert against the unique { userId, host } index.
      if (err?.code !== DUPLICATE_KEY_ERROR_CODE) throw err;
      await RedmineLinks.updateAsync(selector, update);
    }
    // A key for a different account must not be served the previous one's
    // statuses, projects or members (as `redmine.connect`).
    bustUserCaches(userId);
    return { host: entry.host, connected: true, login: user.login };
  },

  /** Remove the caller's account on `server`. Their main link stays. */
  async 'sources.disconnect'({ server } = {}) {
    const { userId } = await requireIdentity(this);
    const host = hostOf(server);
    if (!host) throw new Meteor.Error('bad-request', 'A server address is required.');
    if (host === GITHUB_HOST) {
      const account = await findRedmineAccount(userId, host);
      if (account) await revokeGithubToken(account.apiKey);
    }
    await RedmineLinks.removeAsync({ userId, host });
    bustUserCaches(userId);
    return { host, connected: false };
  },
});
