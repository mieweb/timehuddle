/**
 * Connect GitHub (#873): a member authorizes TimeHuddle on GitHub's page and
 * comes back connected, with their token stored for them alone. A separate
 * request from GitHub sign-in, which asks for `user:email` and keeps no token.
 *
 * The round trip leaves the app, so it works like linking an account
 * (github-link.js), for the same reason: whoever holds a connect URL can finish
 * it in any browser, so an attacker could send theirs to someone else and have
 * that person's token land on the attacker's account. So the callback only stages
 * the token, encrypted, on the user who asked, and hands the browser a one-time
 * code; `sources.confirmGithub` completes it, for that same signed-in user only.
 * Only hashes of the connect token and the code are stored, and each soon expires.
 *
 * Also here: the connection's status, disconnecting (which revokes the token at
 * GitHub), and the accounts the member brings issues from.
 */
import { Accounts } from 'meteor/accounts-base';
import { Meteor } from 'meteor/meteor';
import { Random } from 'meteor/random';

import { requireIdentity } from './auth-bridge';
import { DUPLICATE_KEY_ERROR_CODE, GithubLinks } from './collections';
import { githubApiUrl, githubConfigured, revokeGithubToken, tokenFields } from './github-client';
import { createRateLimiter } from './rate-limit';
import { enforceRedmineLimit } from './redmine';
import { bustUserCaches } from './redmine-cache';
import { EngineError } from './sources/engine';
import { cleanOwners, githubOwners } from './sources/github-hooks';
import { driverFor } from './sources/registry';

const CONNECT_TTL_MS = 10 * 60 * 1000;
const PENDING = 'services.githubConnect';
const ownersLimiter = createRateLimiter({ limit: 30, windowMs: 60 * 1000 });

/** Remove and return `filter`'s pending connection, if unexpired: of two redemptions one wins. */
function consumePending(filter) {
  return Meteor.users.rawCollection().findOneAndUpdate(
    { ...filter, [`${PENDING}.expiresAt`]: { $gt: new Date() } },
    { $unset: { [PENDING]: 1 } },
    { projection: { _id: 1, [PENDING]: 1 } },
  );
}

/**
 * OAuth callback half: stage GitHub's `tokens` on whoever `connectToken` was
 * issued to. Returns `{ code }` for `sources.confirmGithub`, or `{ error }`.
 */
export async function stageGithubConnect(connectToken, tokens) {
  const user = await consumePending({
    [`${PENDING}.hashedToken`]: Accounts._hashLoginToken(connectToken),
  });
  if (!user) return { error: 'expired' };
  if (!tokens?.access_token) return { error: 'refused' };

  const res = await fetch(`${githubApiUrl()}/user`, {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'TimeHuddle',
    },
    redirect: 'error',
  });
  const githubUser = await res.json().catch(() => null);
  if (!res.ok || !Number.isInteger(githubUser?.id)) return { error: 'refused' };

  const code = Random.secret();
  await Meteor.users.updateAsync(user._id, {
    $set: {
      [PENDING]: {
        confirmHash: Accounts._hashLoginToken(code),
        githubId: githubUser.id,
        login: githubUser.login,
        ...tokenFields(tokens),
        expiresAt: new Date(Date.now() + CONNECT_TTL_MS),
      },
    },
  });
  return { code };
}

/** What Settings → Sources shows of `link`; never the token. */
function statusOf(link) {
  return {
    configured: githubConfigured(),
    connected: Boolean(link && !link.rejectedAt),
    rejected: Boolean(link?.rejectedAt),
    login: link?.login ?? null,
    // The accounts the member brings issues from; null for all of them.
    owners: link?.owners ?? null,
  };
}

Meteor.startup(async () => {
  try {
    await GithubLinks.createIndexAsync({ userId: 1 }, { unique: true, name: 'unique_github_link_user' });
  } catch (error) {
    console.error('[github] failed to create unique userId index:', error);
  }
});

Meteor.methods({
  /** The caller's GitHub connection. */
  async 'sources.github'() {
    const { userId } = await requireIdentity(this);
    return statusOf(await GithubLinks.findOneAsync({ userId }));
  },

  /** A single-use token to start with: `/auth/github?connect=<token>`. */
  async 'sources.githubConnectToken'() {
    const { userId } = await requireIdentity(this);
    if (!githubConfigured()) {
      throw new Meteor.Error('not-configured', "GitHub isn't set up on this TimeHuddle.");
    }
    const token = Random.secret();
    await Meteor.users.updateAsync(userId, {
      $set: {
        [PENDING]: {
          hashedToken: Accounts._hashLoginToken(token),
          expiresAt: new Date(Date.now() + CONNECT_TTL_MS),
        },
      },
    });
    return { token };
  },

  /** Finish the connection the callback staged, as the user who started it. */
  async 'sources.confirmGithub'({ code } = {}) {
    const { userId } = await requireIdentity(this);
    if (typeof code !== 'string' || !code) {
      throw new Meteor.Error('bad-request', 'code is required');
    }
    const user = await consumePending({
      _id: userId,
      [`${PENDING}.confirmHash`]: Accounts._hashLoginToken(code),
    });
    const pending = user?.services?.githubConnect;
    if (!pending) throw new Meteor.Error('expired', 'That connection expired. Connect again.');

    const previous = await GithubLinks.findOneAsync({ userId });
    const update = {
      $set: {
        userId,
        githubId: pending.githubId,
        login: pending.login,
        token: pending.token,
        linkedAt: new Date(),
        ...(pending.refreshToken ? { refreshToken: pending.refreshToken } : {}),
        ...(pending.tokenExpiresAt ? { tokenExpiresAt: pending.tokenExpiresAt } : {}),
      },
      $unset: {
        rejectedAt: '',
        ...(pending.refreshToken ? {} : { refreshToken: '', tokenExpiresAt: '' }),
        // Another GitHub account's picks don't apply to this one.
        ...(previous && previous.githubId !== pending.githubId ? { owners: '' } : {}),
      },
    };
    try {
      await GithubLinks.upsertAsync({ userId }, update);
    } catch (err) {
      if (err?.code !== DUPLICATE_KEY_ERROR_CODE) throw err;
      await GithubLinks.updateAsync({ userId }, update);
    }
    // Another GitHub account must not be served the previous one's repos.
    bustUserCaches(userId);
    return statusOf(await GithubLinks.findOneAsync({ userId }));
  },

  /** Remove the caller's GitHub connection, revoking its token at GitHub. */
  async 'sources.disconnectGithub'() {
    const { userId } = await requireIdentity(this);
    const link = await GithubLinks.findOneAsync({ userId });
    if (link && githubConfigured()) await revokeGithubToken(link);
    await GithubLinks.removeAsync({ userId });
    bustUserCaches(userId);
    return statusOf(null);
  },

  /** The GitHub accounts and organizations the caller can bring issues from. */
  async 'sources.githubOwners'() {
    const { userId } = await requireIdentity(this);
    enforceRedmineLimit(ownersLimiter, userId);
    const driver = driverFor('github');
    try {
      const session = await driver.open(userId);
      return { owners: await githubOwners(session.ctx) };
    } catch (err) {
      throw err instanceof Meteor.Error ? err : driver.toError(err);
    }
  },

  /** Bring GitHub issues only from `owners`, or from every account with null or none. */
  async 'sources.setGithubOwners'({ owners } = {}) {
    const { userId } = await requireIdentity(this);
    let picked;
    try {
      picked = cleanOwners(owners);
    } catch (err) {
      if (err instanceof EngineError) throw new Meteor.Error('bad-request', err.message);
      throw err;
    }
    const changed = await GithubLinks.updateAsync(
      { userId },
      picked ? { $set: { owners: picked } } : { $unset: { owners: '' } },
    );
    if (!changed) throw new Meteor.Error('not-connected', 'Connect GitHub first.');
    // The search bar's suggestions came from the previous choice.
    bustUserCaches(userId);
    return { owners: picked };
  },
});
