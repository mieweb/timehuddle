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
import { toStatus } from './redmine-status';

const DUPLICATE_KEY_ERROR_CODE = 11000;

// Enforce the "one link per user" invariant at the storage layer so concurrent
// first-time `redmine.connect` calls can't both insert (Mongo `_id` uniqueness
// alone doesn't guard the `userId` upsert key). Mirrors the unique-index pattern
// in org-helpers.js used for the same concurrent-upsert race.
Meteor.startup(async () => {
  try {
    await RedmineLinks.createIndexAsync({ userId: 1 }, { unique: true, name: 'unique_redmine_link_user' });
  } catch (error) {
    console.error('[redmine] failed to create unique userId index:', error);
  }
});

/**
 * Server-configured Redmine base URL, or null if unset. Used only to shape the
 * status response; connect validates a real URL separately before writing.
 */
function configuredBaseUrl() {
  try {
    return redmineBaseUrl();
  } catch {
    return null;
  }
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

    // `baseUrl` is intentionally NOT persisted: the configured instance is the
    // single source of truth, derived at read time in `toStatus`.
    const update = {
      $set: {
        userId,
        redmineUserId: user.id,
        redmineLogin: user.login,
        firstname: user.firstname ?? '',
        lastname: user.lastname ?? '',
        mail: user.mail ?? '',
        apiKey: encryptSecret(key, envKey()),
        linkedAt: new Date(),
      },
    };
    try {
      await RedmineLinks.upsertAsync({ userId }, update);
    } catch (err) {
      // Lost a concurrent first-insert race against the unique userId index;
      // the row now exists, so retry as a plain update.
      if (err?.code === DUPLICATE_KEY_ERROR_CODE) {
        await RedmineLinks.updateAsync({ userId }, update);
      } else {
        throw err;
      }
    }

    return toStatus(await RedmineLinks.findOneAsync({ userId }), baseUrl);
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
    return toStatus(await RedmineLinks.findOneAsync({ userId }), configuredBaseUrl());
  },
});
