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
 * through the OAuth `state`, and redeemed by the callback. Only its hash is
 * stored, and it expires after LINK_TOKEN_TTL_MS.
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
 * Redeem a link token and link `githubUser` to the user who requested it.
 * Returns `'connected'`, or the reason it was refused: `'expired'` (unknown,
 * used or expired token) or `'taken'` (that GitHub account is another user's).
 */
export async function redeemGithubLink(linkToken, githubUser) {
  const hashed = Accounts._hashLoginToken(linkToken);
  const user = await Meteor.users.findOneAsync(
    {
      'services.githubLink.hashedToken': hashed,
      'services.githubLink.expiresAt': { $gt: new Date() },
    },
    { fields: { _id: 1 } },
  );
  // Single use, whatever happens next.
  await Meteor.users.updateAsync(
    { 'services.githubLink.hashedToken': hashed },
    { $unset: { 'services.githubLink': 1 } },
  );
  if (!user) return 'expired';

  const owner = await findUserIdByGithubId(githubUser.id);
  if (owner && owner !== user._id) return 'taken';

  await Meteor.users.updateAsync(user._id, {
    $set: { 'services.github': { id: githubUser.id, username: githubUser.login } },
  });
  return 'connected';
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
   * Unlink the caller's GitHub account. Always safe: sign-in by GitHub email,
   * password and the other providers are unaffected.
   */
  async 'github.disconnect'() {
    const { userId } = await requireIdentity(this);
    await Meteor.users.updateAsync(userId, { $unset: { 'services.github': 1 } });
    return statusFor(null);
  },
});
