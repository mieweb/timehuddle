/**
 * Per-user Redmine credential access.
 *
 * One place that turns a TimeHuddle userId into a usable Redmine account, so
 * the decrypt-at-read step isn't repeated by every caller that needs to talk to
 * Redmine on a user's behalf (`redmine.issues.relevant`, the source-aware timer
 * paths in `ticket-refs.js`, …). The plaintext key never leaves the server.
 */
import { Meteor } from 'meteor/meteor';

import { RedmineLinks } from './collections';
import { createUserTtlCache } from './redmine-cache';
import { getCurrentUser, linkedRedmineBaseUrl } from './redmine-client';
import { decryptStoredSecret, encryptSecret, envKey } from './redmine-crypto';

/**
 * The caller's Redmine account — `{ userId, apiKey, baseUrl }`, the decrypted
 * personal key, the instance that issued it, and whose it is (what the outbound
 * budget in redmine-client.js counts against) — or null when they have not linked one.
 * Null is an ordinary state, not an error: the caller decides whether "not
 * connected" is fatal (starting a timer) or just means "nothing to resolve"
 * (rendering a timesheet).
 */
export async function findRedmineAccount(userId) {
  const link = await RedmineLinks.findOneAsync({ userId });
  if (!link) return null;

  const { secret, rotated } = decryptStoredSecret(link.apiKey);
  // A key that only opened under the previous encryption key is rewritten under
  // the current one, once, here — decrypting it successfully *is* the "next
  // successful use". Fire-and-forget: a read path must not fail because a
  // re-encrypt did, and the next read would simply try again. Matched on the
  // ciphertext that was read, so a key connected meanwhile is never overwritten
  // with this older one.
  if (rotated) {
    RedmineLinks.updateAsync(
      { userId, apiKey: link.apiKey },
      { $set: { apiKey: encryptSecret(secret, envKey()) } },
    ).catch((error) => console.error('[redmine] failed to re-encrypt a rotated API key:', error));
  }

  return { userId, apiKey: secret, baseUrl: linkedRedmineBaseUrl(link.baseUrl) };
}

/**
 * The caller's account, or a `not-connected` error — for the paths where no link
 * means "you cannot do this yet" rather than "there is nothing to resolve".
 * Shared, so the message a user sees does not depend on which method they hit.
 */
export async function requireRedmineAccount(userId) {
  const account = await findRedmineAccount(userId);
  if (!account) throw new Meteor.Error('not-connected', 'Connect your Redmine account first.');
  return account;
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
  const link = await RedmineLinks.findOneAsync({ userId }, { fields: { redmineUserId: 1 } });
  if (link?.redmineUserId != null) return link.redmineUserId;
  return redmineUserIdCache.get(userId, 'redmineUserId', async () => {
    const user = await getCurrentUser(account);
    return user?.id ?? null;
  });
}
