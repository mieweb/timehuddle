/**
 * Redmine account linking (Milestone 1).
 *
 * A TimeHuddle user links their personal Redmine account by pasting their API
 * key. We validate it against `GET /users/current.json`, then store one
 * `redmine_links` row per user with the key encrypted at rest. The key is never
 * returned to the client or logged.
 *
 * Any Redmine account can be linked to any TimeHuddle account: the key alone
 * identifies the Redmine user, so there is no email matching or admin step.
 */
import { Meteor } from 'meteor/meteor';

import { RedmineLinks } from './collections';
import { requireIdentity } from './auth-bridge';
import { getCurrentUser, redmineBaseUrl } from './redmine-client';
import { encryptSecret, envKey } from './redmine-crypto';

/**
 * Shape a `redmine_links` row into the client-safe status object. Never
 * includes the encrypted API key. `redmineName` is resolved here (read time)
 * from the persisted canonical name fields rather than being stored.
 */
function toStatus(link) {
  if (!link) return { connected: false };
  const fullName = `${link.firstname ?? ''} ${link.lastname ?? ''}`.trim();
  return {
    connected: true,
    redmineUserId: link.redmineUserId,
    redmineLogin: link.redmineLogin,
    redmineName: fullName || link.redmineLogin,
    baseUrl: link.baseUrl,
    linkedAt: link.linkedAt instanceof Date ? link.linkedAt.toISOString() : (link.linkedAt ?? null),
  };
}

Meteor.methods({
  /**
   * Validate a personal Redmine API key and link it to the calling user.
   * Upsert is keyed on `userId`, so reconnecting with a different key re-links.
   */
  async 'redmine.connect'({ apiKey } = {}) {
    const { userId } = await requireIdentity(this);

    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Meteor.Error('bad-request', 'A Redmine API key is required.');
    }
    const key = apiKey.trim();

    let baseUrl;
    try {
      baseUrl = redmineBaseUrl();
    } catch {
      throw new Meteor.Error('not-configured', 'Redmine is not configured on the server.');
    }

    let user;
    try {
      user = await getCurrentUser(key);
    } catch (err) {
      if (err?.status === 401 || err?.status === 403) {
        throw new Meteor.Error('invalid-key', 'That API key was rejected by Redmine.');
      }
      throw new Meteor.Error(
        'unreachable',
        'Could not reach Redmine. Check the server URL and that the REST API is enabled.',
      );
    }
    if (!user) {
      throw new Meteor.Error('invalid-key', 'That API key was rejected by Redmine.');
    }

    await RedmineLinks.upsertAsync(
      { userId },
      {
        $set: {
          userId,
          redmineUserId: user.id,
          redmineLogin: user.login,
          firstname: user.firstname ?? '',
          lastname: user.lastname ?? '',
          mail: user.mail ?? '',
          apiKey: encryptSecret(key, envKey()),
          baseUrl,
          linkedAt: new Date(),
        },
      },
    );

    return toStatus(await RedmineLinks.findOneAsync({ userId }));
  },

  /** Remove the caller's Redmine link. */
  async 'redmine.disconnect'() {
    const { userId } = await requireIdentity(this);
    await RedmineLinks.removeAsync({ userId });
    return { connected: false };
  },

  /** Report the caller's Redmine connection status (never the key). */
  async 'redmine.status'() {
    const { userId } = await requireIdentity(this);
    return toStatus(await RedmineLinks.findOneAsync({ userId }));
  },
});
