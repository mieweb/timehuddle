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
import {
  EVENTS,
  ORG_SETTING_FOR_EVENT,
  allEventSettings,
  prefsPatchToSet,
  quietSettings,
} from './notification-prefs-core';
import { resolveSettingsForTeams } from './settings';

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

/**
 * Of `userIds`, those who set `teamId`'s Huddle to All posts — one query, so a
 * new post doesn't read every member's preferences to find the few who want it.
 */
export async function usersFollowingTeam(teamId, userIds) {
  if (!userIds.length) return [];
  const docs = await notificationPrefs()
    .find({ userId: { $in: userIds }, [`teams.${teamId}`]: 'all' }, { projection: { userId: 1 } })
    .toArray();
  return docs.map((doc) => doc.userId);
}

/** Clocking in ends an "until I clock in" snooze. */
export async function endSnoozeUntilClockIn(userId) {
  await notificationPrefs().updateOne(
    { userId, 'quiet.snoozeUntilClockIn': true },
    { $set: { 'quiet.snoozeUntilClockIn': false, updatedAt: new Date() } },
  );
}

/**
 * Events an organization has locked for one of this user's teams, with the
 * value it locked them at, so Settings shows them as fixed. A lock applies per
 * team; any team locking it on wins over one locking it off, and showing the
 * row locked when any team locks it is the simple reading for the common case
 * of one organization.
 */
async function lockedEvents(userId) {
  const teams = await rawDb()
    .collection('teams')
    .find({ $or: [{ members: userId }, { admins: userId }] })
    .toArray();
  const resolved = await resolveSettingsForTeams(teams);
  const locked = {};
  for (const [eventKey, setting] of Object.entries(ORG_SETTING_FOR_EVENT)) {
    const locks = resolved.map((r) => r[setting]).filter((value) => value.locked);
    if (locks.length) locked[eventKey] = locks.some((value) => value.value);
  }
  return locked;
}

/** What the client shows: every event's effective setting, team levels, quiet time and locks. */
async function toClient(userId, prefs) {
  const quiet = quietSettings(prefs);
  const locked = await lockedEvents(userId);
  const events = allEventSettings(prefs);
  // A locked event is delivered on its defaults when locked on, and not at
  // all when locked off: show that, not the saved choice.
  for (const [key, on] of Object.entries(locked)) {
    events[key] = on
      ? { desktop: EVENTS[key].desktop, phone: EVENTS[key].phone }
      : { desktop: false, phone: false };
  }
  return {
    events,
    teams: prefs?.teams ?? {},
    quiet: {
      ...quiet,
      snoozeUntil: quiet.snoozeUntil ? new Date(quiet.snoozeUntil).toISOString() : null,
    },
    locked: Object.keys(locked),
  };
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
    return toClient(userId, await getPrefs(userId));
  },

  async 'notificationPrefs.update'(patch) {
    const { userId } = await requireIdentity(this);
    try {
      await savePrefs(userId, patch);
    } catch (error) {
      if (error instanceof Meteor.Error) throw error;
      throw new Meteor.Error('bad-request', error.message);
    }
    return toClient(userId, await getPrefs(userId));
  },
});
