/**
 * Linking a GitHub account to an existing TimeHuddle user (#725).
 *
 * GitHub sign-in (`/auth/github` in main.js) otherwise finds the user by the
 * primary verified email on the GitHub account, so it only works when that
 * email matches. A link stores the GitHub user id on the account instead, and
 * sign-in checks it first — so a GitHub account with a different email still
 * reaches the right user.
 *
 * The OAuth round trip leaves the app, so the caller is identified on the way
 * back by a single-use link token: issued here to a signed-in user, carried
 * through the OAuth `state`, and redeemed by the callback.
 *
 * The callback does not link on its own. Whoever holds a link URL can finish
 * it in any browser, so an attacker could send theirs to someone else and
 * have that person's GitHub attached to the attacker's account — after which
 * the victim's GitHub sign-in lands in it. So the callback only stages the
 * GitHub account on the token's owner and hands the browser a one-time
 * confirm code; `github.confirmLink` completes it, and only for that same
 * signed-in user. Only hashes of the token and the code are stored, and each
 * expires after LINK_TOKEN_TTL_MS.
 */
import { Accounts } from 'meteor/accounts-base';
import { Meteor } from 'meteor/meteor';
import { Random } from 'meteor/random';

import { requireIdentity } from './auth-bridge';

const LINK_TOKEN_TTL_MS = 10 * 60 * 1000;

function statusFor(user) {
  const github = user?.services?.github;
  return github?.id
    ? { connected: true, username: github.username ?? null }
    : { connected: false, username: null };
}

/** The user a GitHub account is linked to, or null. */
export async function findUserIdByGithubId(githubId) {
  const user = await Meteor.users.findOneAsync(
    { 'services.github.id': githubId },
    { fields: { _id: 1 } },
  );
  return user?._id ?? null;
}

/**
 * Atomically remove and return the caller's pending link if `filter` still
 * matches it unexpired — so of two overlapping redemptions only one wins.
 */
async function consumeGithubLink(filter) {
  return Meteor.users.rawCollection().findOneAndUpdate(
    { ...filter, 'services.githubLink.expiresAt': { $gt: new Date() } },
    { $unset: { 'services.githubLink': 1 } },
    { projection: { _id: 1, 'services.githubLink': 1 } },
  );
}

/** True when `githubId` is already linked to someone other than `userId`. */
async function linkedElsewhere(githubId, userId) {
  const owner = await findUserIdByGithubId(githubId);
  return !!owner && owner !== userId;
}

/**
 * OAuth callback half: redeem a link token and stage `githubUser` on the user
 * who requested it, pending `github.confirmLink` (see the header for why).
 * Returns `{ result: 'pending', code }`, or the reason it was refused:
 * `'expired'` (unknown, used or expired token) or `'taken'` (that GitHub
 * account is another user's).
 */
export async function stageGithubLink(linkToken, githubUser) {
  const user = await consumeGithubLink({
    'services.githubLink.hashedToken': Accounts._hashLoginToken(linkToken),
  });
  if (!user) return { result: 'expired' };
  if (await linkedElsewhere(githubUser.id, user._id)) return { result: 'taken' };

  const code = Random.secret();
  await Meteor.users.updateAsync(user._id, {
    $set: {
      'services.githubLink': {
        confirmHash: Accounts._hashLoginToken(code),
        githubId: githubUser.id,
        username: githubUser.login,
        expiresAt: new Date(Date.now() + LINK_TOKEN_TTL_MS),
      },
    },
  });
  return { result: 'pending', code };
}

Meteor.methods({
  /** The caller's GitHub link: `{ connected, username }`. */
  async 'github.status'() {
    const { userId } = await requireIdentity(this);
    return statusFor(await Meteor.users.findOneAsync(userId, { fields: { 'services.github': 1 } }));
  },

  /** A single-use token to start the link flow with (`/auth/github?link=<token>`). */
  async 'github.linkToken'() {
    const { userId } = await requireIdentity(this);
    const token = Random.secret();
    await Meteor.users.updateAsync(userId, {
      $set: {
        'services.githubLink': {
          hashedToken: Accounts._hashLoginToken(token),
          expiresAt: new Date(Date.now() + LINK_TOKEN_TTL_MS),
        },
      },
    });
    return { token };
  },

  /**
   * Finish a link the OAuth callback staged, as the user who started it.
   * Returns `{ result, status }`, `result` being `'connected'`, `'expired'`
   * (unknown, used or expired code, or another user's) or `'taken'`.
   */
  async 'github.confirmLink'({ code } = {}) {
    const { userId } = await requireIdentity(this);
    if (typeof code !== 'string' || !code) {
      throw new Meteor.Error('bad-request', 'code is required');
    }
    const user = await consumeGithubLink({
      _id: userId,
      'services.githubLink.confirmHash': Accounts._hashLoginToken(code),
    });
    const pending = user?.services?.githubLink;
    const current = () => Meteor.users.findOneAsync(userId, { fields: { 'services.github': 1 } });
    if (!pending) return { result: 'expired', status: statusFor(await current()) };
    // Checked again: another user may have linked it since the callback.
    if (await linkedElsewhere(pending.githubId, userId)) {
      return { result: 'taken', status: statusFor(await current()) };
    }

    const github = { id: pending.githubId, username: pending.username };
    await Meteor.users.updateAsync(userId, { $set: { 'services.github': github } });
    return { result: 'connected', status: statusFor({ services: { github } }) };
  },

  /**
   * Unlink the caller's GitHub account. Always safe: sign-in by GitHub email,
   * password and the other providers are unaffected.
   */
  async 'github.disconnect'() {
    const { userId } = await requireIdentity(this);
    await Meteor.users.updateAsync(userId, { $unset: { 'services.github': 1 } });
    return statusFor(null);
  },
});
