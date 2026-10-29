/**
 * Notification create + clock-admin fan-out, shared by the clock methods and
 * the Agenda jobs. Port of notificationService.create + ClockService
 * .notifyClockAdmins from the Fastify backend.
 *
 * Persists to the shared `notifications` collection (oplog → Meteor inbox
 * publication) and fires a web-push via push.js. The SSE broadcast the Fastify
 * version did is replaced by the reactive `notifications.liveForUser` pub.
 */
import { MongoInternals } from 'meteor/mongo';
import { ClockEvents, rawDb, isValidId } from './collections';
import { sendToUser } from './push';
import { findUserById } from './auth-bridge';
import {
  DELIVER_EVERYWHERE,
  needsClockState,
  prefKeyForType,
  resolveDelivery,
} from './notification-prefs-core';
import { getPrefs } from './notification-prefs';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

function notifications() {
  return rawDb().collection('notifications');
}

/**
 * Where the user wants this notification (#784). Types that aren't
 * configurable skip the preferences read entirely.
 */
async function deliveryFor(userId, data) {
  if (!prefKeyForType(data?.type)) return DELIVER_EVERYWHERE;
  const prefs = await getPrefs(userId);
  // Only quiet time needs the clock, so most users never pay for this read.
  const clockedIn = needsClockState(prefs)
    ? Boolean(await ClockEvents.findOneAsync({ userId, endTime: null }, { fields: { _id: 1 } }))
    : true;
  return resolveDelivery(prefs, {
    type: data.type,
    teamId: data.teamId,
    now: new Date(),
    clockedIn,
  });
}

/**
 * Insert a notification and fire push, as the user's notification preferences
 * allow. Returns the inserted document, or null when the user has the event
 * turned off. Mirror of notificationService.create.
 */
export async function createNotification({ userId, title, body, data }) {
  const delivery = await deliveryFor(userId, data);
  if (!delivery.inbox) return null;
  const doc = {
    _id: new ObjectId(),
    userId,
    title,
    body,
    ...(data ? { data } : {}),
    read: false,
    createdAt: new Date(),
  };
  await notifications().insertOne(doc);
  if (delivery.desktop || delivery.phone) {
    sendToUser(userId, { title, body, tag: data?.type, data }, delivery).catch((err) =>
      console.error('[push] sendToUser failed:', err)
    );
  }
  return doc;
}

/**
 * Notify all team admins when a clock session is added, updated, or deleted.
 * Mirror of ClockService.notifyClockAdmins.
 */
export async function notifyClockAdmins(actorUserId, teamId, startTime, action) {
  if (!isValidId(teamId)) return;
  const team = await rawDb().collection('teams').findOne({ _id: new ObjectId(teamId) });
  if (!team || !team.admins || team.admins.length === 0) return;

  const profile = await rawDb()
    .collection('profiles')
    .findOne({ userId: actorUserId, app: 'timeharbor' });
  const actor = await findUserById(actorUserId);
  const actorName =
    profile?.displayName ||
    actor?.name ||
    'A team member';
  const date = new Date(startTime).toISOString().slice(0, 10);

  await Promise.all(
    team.admins.map((adminId) =>
      createNotification({
        userId: adminId,
        title: 'Timesheet Update',
        body: `${actorName} has ${action} a clock session for ${date} in ${team.name}`,
        data: {
          type: 'clock-session-changed',
          teamId,
          date,
          userId: actorUserId,
          url: `/app/dashboard?tab=timesheet&memberId=${actorUserId}&teamId=${teamId}`,
        },
      }).catch(() => {})
    )
  );
}

/** Resolve a user's display name (better-auth `user` collection). */
export async function userDisplayName(userId) {
  const user = await findUserById(userId);
  return user?.name ?? user?.email?.split('@')[0] ?? 'Someone';
}
