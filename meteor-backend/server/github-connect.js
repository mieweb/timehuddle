/**
 * Connect GitHub (#734 step 4): a member authorizes TimeHuddle on GitHub's page
 * and comes back connected, with their token stored for them alone. A separate
 * request from GitHub sign-in, which asks for `user:email` and keeps no token.
 *
 * The round trip leaves the app, so it works like linking an account
 * (github-link.js), for the same reason: whoever holds a connect URL can finish
 * it in any browser, so an attacker could send theirs to someone else and have
 * that person's token land on the attacker's account. So the callback only stages
 * the token, encrypted, on the user who asked, and hands the browser a one-time
 * code; `sources.confirmGithub` completes it, for that same signed-in user only.
 * Only hashes of the token and the code are stored, and each soon expires.
 */
import { Accounts } from 'meteor/accounts-base';
import { Meteor } from 'meteor/meteor';
import { Random } from 'meteor/random';

import { requireIdentity } from './auth-bridge';
import { DUPLICATE_KEY_ERROR_CODE, RedmineLinks } from './collections';
import { GITHUB_HOST, githubApiUrl, githubConfigured, tokenFields } from './github-client';
import { keyOwnerOf } from './redmine-account';
import { bustUserCaches } from './redmine-cache';

const CONNECT_TTL_MS = 10 * 60 * 1000;
const PENDING = 'services.githubConnect';

const ownerOf = (userId) => keyOwnerOf({ userId, host: GITHUB_HOST });

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
        ...tokenFields(tokens, ownerOf(user._id)),
        expiresAt: new Date(Date.now() + CONNECT_TTL_MS),
      },
    },
  });
  return { code };
}

Meteor.methods({
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

    const selector = { userId, host: GITHUB_HOST };
    const update = {
      $set: {
        ...selector,
        baseUrl: githubApiUrl(),
        redmineUserId: pending.githubId,
        redmineLogin: pending.login,
        apiKey: pending.apiKey,
        linkedAt: new Date(),
        ...(pending.refreshKey ? { refreshKey: pending.refreshKey } : {}),
        ...(pending.tokenExpiresAt ? { tokenExpiresAt: pending.tokenExpiresAt } : {}),
      },
      $unset: {
        rejectedAt: '',
        ...(pending.refreshKey ? {} : { refreshKey: '', tokenExpiresAt: '' }),
      },
    };
    try {
      await RedmineLinks.upsertAsync(selector, update);
    } catch (err) {
      if (err?.code !== DUPLICATE_KEY_ERROR_CODE) throw err;
      await RedmineLinks.updateAsync(selector, update);
    }
    // Another GitHub account must not be served the previous one's repos.
    bustUserCaches(userId);
    return { host: GITHUB_HOST, connected: true, login: pending.login };
  },
});
