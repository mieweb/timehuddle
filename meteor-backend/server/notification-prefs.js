/**
 * Storage and methods for each user's notification preferences (#784).
 *
 * One document per user in `notificationPrefs`, holding only what the user
 * changed — an absent key means the event's default. What the stored values
 * mean is in notification-prefs-core.js.
 */
import { Meteor } from 'meteor/meteor';
import { rawDb } from './collections';
import { requireIdentity } from './auth-bridge.js';
import { allEventSettings, prefsPatchToSet } from './notification-prefs-core';

function notificationPrefs() {
  return rawDb().collection('notificationPrefs');
}

/** One document per user: the invariant every read and upsert relies on. */
export async function ensureNotificationPrefIndexes() {
  await notificationPrefs().createIndex(
    { userId: 1 },
    { unique: true, name: 'unique_notification_prefs_user' },
  );
}

/** A user's stored preferences, or null when they have never saved any. */
export function getPrefs(userId) {
  return notificationPrefs().findOne({ userId });
}

/** Apply a validated patch (see prefsPatchToSet), creating the document on first save. */
export async function savePrefs(userId, patch) {
  const set = prefsPatchToSet(patch);
  await notificationPrefs().updateOne(
    { userId },
    { $set: { ...set, updatedAt: new Date() } },
    { upsert: true },
  );
}

/** What the Settings page shows: every event's effective setting. */
function toClient(prefs) {
  return { events: allEventSettings(prefs) };
}

Meteor.startup(async () => {
  try {
    await ensureNotificationPrefIndexes();
  } catch (error) {
    console.error('[notification-prefs] failed to create indexes:', error);
  }
});

Meteor.methods({
  async 'notificationPrefs.get'() {
    const { userId } = await requireIdentity(this);
    return toClient(await getPrefs(userId));
  },

  async 'notificationPrefs.update'(patch) {
    const { userId } = await requireIdentity(this);
    try {
      await savePrefs(userId, patch);
    } catch (error) {
      if (error instanceof Meteor.Error) throw error;
      throw new Meteor.Error('bad-request', error.message);
    }
    return toClient(await getPrefs(userId));
  },
});
