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
import { enforceRedmineLimit } from './redmine';
import { keyOwnerOf, mainLinkOf } from './redmine-account';
import { getCurrentUser, linkedRedmineBaseUrl, optionalRedmineBaseUrl } from './redmine-client';
import { encryptSecret, envKey } from './redmine-crypto';
import { createRateLimiter } from './rate-limit';
import { hostOf, ticketIdsFor } from './ticket-ids';

const connectLimiter = createRateLimiter({ limit: 30, windowMs: 60 * 1000 });

/** The server at `address` if one of `userId`'s orgs registered it, else null. */
async function registeredServer(userId, address) {
  const host = hostOf(address);
  if (!host) return null;
  const teams = await Teams.find(
    { $or: [{ members: userId }, { admins: userId }] },
    { fields: { orgId: 1 } },
  ).fetchAsync();
  const idsByOrg = await ticketIdsFor(
    rawDb(),
    teams.map((team) => team.orgId).filter(Boolean),
  );
  for (const { sourcePrefixes } of idsByOrg.values()) {
    const entry = sourcePrefixes.find((server) => server.host === host);
    if (entry) return entry;
  }
  return null;
}

/** The host `userId`'s main link talks to: the deployment's Redmine unless they linked elsewhere. */
async function mainHost(userId) {
  const main = await RedmineLinks.findOneAsync(mainLinkOf(userId), { fields: { baseUrl: 1 } });
  return hostOf(linkedRedmineBaseUrl(main?.baseUrl) ?? optionalRedmineBaseUrl());
}

Meteor.methods({
  /**
   * Connect the caller to `server`, a registered server's address, with their
   * own `apiKey`. Validated with Redmine first; reconnecting replaces the key
   * and clears a rejected one's mark. The main server is connected in Settings
   * → Redmine instead.
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
      throw new Meteor.Error('main-server', 'Connect this server in Settings → Redmine.');
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
    return { host: entry.host, connected: true, login: user.login };
  },

  /** Remove the caller's account on `server`. Their main link stays. */
  async 'sources.disconnect'({ server } = {}) {
    const { userId } = await requireIdentity(this);
    const host = hostOf(server);
    if (!host) throw new Meteor.Error('bad-request', 'A server address is required.');
    await RedmineLinks.removeAsync({ userId, host });
    return { host, connected: false };
  },
});
