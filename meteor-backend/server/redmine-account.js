/**
 * Per-user Redmine credential access.
 *
 * One place that turns a TimeHuddle userId into a usable Redmine account, so
 * the decrypt-at-read step isn't repeated by every caller that needs to talk to
 * Redmine on a user's behalf (`redmine.issues.list`, the source-aware timer
 * paths in `ticket-refs.js`, …). The plaintext key never leaves the server.
 */
import { Meteor } from 'meteor/meteor';

import { RedmineLinks } from './collections';
import { linkedRedmineBaseUrl } from './redmine-client';
import { decryptSecret, envKey } from './redmine-crypto';

/**
 * The caller's Redmine account — `{ apiKey, baseUrl }`, the decrypted personal
 * key and the instance that issued it — or null when they have not linked one.
 * Null is an ordinary state, not an error: the caller decides whether "not
 * connected" is fatal (starting a timer) or just means "nothing to resolve"
 * (rendering a timesheet).
 */
export async function findRedmineAccount(userId) {
  const link = await RedmineLinks.findOneAsync({ userId });
  if (!link) return null;
  return {
    apiKey: decryptSecret(link.apiKey, envKey()),
    baseUrl: linkedRedmineBaseUrl(link.baseUrl),
  };
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
