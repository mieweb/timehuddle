/**
 * Per-user Redmine credential access.
 *
 * One place that turns a TimeHuddle userId into a usable Redmine account, so
 * the decrypt-at-read step isn't repeated by every caller that needs to talk to
 * Redmine on a user's behalf (`redmine.issues.relevant`, the source-aware timer
 * paths in `ticket-refs.js`, …). The plaintext key never leaves the server.
 *
 * A member has a **main link**, today's one, with no `host`: on
 * `REDMINE_BASE_URL`, or a custom URL in dev. Time is sent with it. Since #734
 * step 7 they can also connect other servers their org registered: one row per
 * server, with its `host` and `baseUrl`. The engine reads an issue with the
 * account for the issue's server (`findRedmineAccount(userId, host)`).
 */
import { Meteor } from 'meteor/meteor';

import { RedmineLinks } from './collections';
import { createUserTtlCache } from './redmine-cache';
import { getCurrentUser, linkedRedmineBaseUrl } from './redmine-client';
import { decryptStoredSecret, encryptSecret, envKey } from './redmine-crypto';
import { hostOf } from './ticket-ids';

/** The selector for `userId`'s main link: the one with no `host`. */
export function mainLinkOf(userId) {
  return { userId, host: { $exists: false } };
}

/**
 * Whose a stored key is, as its ciphertext is locked to: the member, and for a
 * row on another server, that server too. A key copied onto another member's
 * row, or another server's, then fails to decrypt.
 */
export function keyOwnerOf(link) {
  return link.host ? `${link.userId}@${link.host}` : String(link.userId);
}

/** The address a link talks to: a main link's as before, another server's as stored. */
function baseUrlOfLink(link) {
  return link.host ? link.baseUrl : linkedRedmineBaseUrl(link.baseUrl);
}

/**
 * `userId`'s link for `host`, or their main link when `host` is omitted. The
 * main link answers for its own server, so a server is never connected twice.
 */
async function findLink(userId, host) {
  const main = await RedmineLinks.findOneAsync(mainLinkOf(userId));
  if (!host || (main && hostOf(baseUrlOfLink(main)) === host)) return main;
  return RedmineLinks.findOneAsync({ userId, host });
}

/**
 * The caller's Redmine account — `{ userId, apiKey, baseUrl, onKeyRejected }`,
 * the decrypted personal key, the instance that issued it, whose it is (what
 * the outbound budget in redmine-client.js counts against), and what to call
 * when Redmine says the key is no good — or null when they have not linked one,
 * or Redmine rejected the one they linked (#734 step 7: a dead key is never
 * sent again until they reconnect).
 * Null is an ordinary state, not an error: the caller decides whether "not
 * connected" is fatal (starting a timer) or just means "nothing to resolve"
 * (rendering a timesheet).
 */
export async function findRedmineAccount(userId, host) {
  const link = await findLink(userId, host);
  if (!link || link.rejectedAt) return null;

  const owner = keyOwnerOf(link);
  const { secret, rewrite } = decryptStoredSecret(link.apiKey, owner);
  // A key that only opened under the previous encryption key, or that was
  // stored before keys were locked to their owner, is rewritten in the current
  // form, once, here — decrypting it successfully *is* the "next successful
  // use", so no bulk migration is needed. Fire-and-forget: a read path must not
  // fail because a re-encrypt did, and the next read would simply try again.
  // Matched on the ciphertext that was read, so a key connected meanwhile is
  // never overwritten with this older one.
  if (rewrite) {
    RedmineLinks.updateAsync(
      { _id: link._id, apiKey: link.apiKey },
      { $set: { apiKey: encryptSecret(secret, envKey(), owner) } },
    ).catch((error) => console.error('[redmine] failed to re-encrypt an API key:', error));
  }

  return {
    userId,
    apiKey: secret,
    baseUrl: baseUrlOfLink(link),
    linkId: link._id,
    // Matched on the key that was read, so a key connected meanwhile is never marked.
    onKeyRejected: () =>
      RedmineLinks.updateAsync(
        { _id: link._id, apiKey: link.apiKey },
        { $set: { rejectedAt: new Date() } },
      ),
  };
}

/**
 * The caller's account, or a `not-connected` error — for the paths where no link
 * means "you cannot do this yet" rather than "there is nothing to resolve".
 * Shared, so the message a user sees does not depend on which method they hit.
 */
export async function requireRedmineAccount(userId, host) {
  const account = await findRedmineAccount(userId, host);
  if (account) return account;
  const rejected = Boolean((await findLink(userId, host))?.rejectedAt);
  throw new Meteor.Error(
    'not-connected',
    rejected
      ? 'Redmine rejected your API key. Reconnect Redmine in Settings.'
      : 'Connect your Redmine account first.',
  );
}

/**
 * The refusal for a caller past a Redmine limit — a method's own
 * (`enforceRedmineLimit`) or the outbound budget in redmine-client.js. Shared for
 * the same reason as `not-connected` above.
 */
export function tooManyRedmineRequests(retryAfterMs) {
  return new Meteor.Error(
    'too-many-requests',
    'Too many Redmine requests. Try again in a moment.',
    retryAfterMs == null ? undefined : { timeToReset: retryAfterMs },
  );
}

/** The caller's own Redmine user id, per user, for an hour. See `redmineUserIdFor`. */
const redmineUserIdCache = createUserTtlCache(60 * 60 * 1000);

/**
 * The caller's own Redmine user id: what `/activity.atom` needs (it has no `me`),
 * and what the issue page and its form tell "mine" apart by.
 *
 * Almost always free: `redmine.connect` already stored it on the link row. The
 * `/users/current.json` fallback is for rows written before it did, and is cached
 * for an hour because a Redmine user id never changes.
 */
export async function redmineUserIdFor(userId, account) {
  const link = await RedmineLinks.findOneAsync(
    account.linkId ? { _id: account.linkId } : mainLinkOf(userId),
    { fields: { redmineUserId: 1 } },
  );
  if (link?.redmineUserId != null) return link.redmineUserId;
  return redmineUserIdCache.get(userId, `redmineUserId:${account.baseUrl}`, async () => {
    const user = await getCurrentUser(account);
    return user?.id ?? null;
  });
}
