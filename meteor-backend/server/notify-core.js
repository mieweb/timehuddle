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
import { ClockEvents, rawDb, isValidId, isObjectIdHex } from './collections';
import { sendToUser } from './push';
import { findUserById } from './auth-bridge';
import {
  DELIVER_EVERYWHERE,
  needsClockState,
  orgSettingForType,
  prefKeyForType,
  resolveDelivery,
} from './notification-prefs-core';
import { getPrefs } from './notification-prefs';
import { resolveSettings } from './settings';
import { isViewingTeam } from './presence';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

function notifications() {
  return rawDb().collection('notifications');
}

/** A team by hex or legacy string id, or null. */
export async function findTeam(teamId) {
  if (!isValidId(teamId)) return null;
  return rawDb()
    .collection('teams')
    .findOne({ _id: isObjectIdHex(teamId) ? new ObjectId(teamId) : teamId });
}

/**
 * The team setting that governs this notification (#784), resolved through the
 * settings hierarchy: `{ value, locked }`, or null when none applies.
 */
async function orgPolicyFor(data) {
  const setting = orgSettingForType(data.type);
  const teamId = data.teamId ? String(data.teamId) : null;
  if (!setting) return null;
  const team = await findTeam(teamId);
  return team ? (await resolveSettings(team))[setting] : null;
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
    viewingTeam: data.teamId ? isViewingTeam(userId, data.teamId) : false,
    orgPolicy: await orgPolicyFor(data),
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
    // Which pop-ups this notification was allowed (#784): an open app's own
    // desktop alert (src/main.tsx) follows it rather than alerting on every row.
    pushed: { desktop: delivery.desktop, phone: delivery.phone },
    createdAt: new Date(),
  };
  await notifications().insertOne(doc);
  if (delivery.desktop || delivery.phone) {
    // The push carries the row's id so tapping it can mark it read; the stored
    // row doesn't need it.
    // Tagged with its own id: a shared tag (the type) made each pop-up silently
    // replace the last one of its kind on desktop and phone.
    const notificationId = doc._id.toHexString();
    const pushData = { ...data, notificationId };
    sendToUser(userId, { title, body, tag: notificationId, data: pushData }, delivery).catch((err) =>
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

/** Where a clock-out notice leads: the session's Huddle post, else the member's Work tab. */
export function clockOutUrl({ userId, teamId, sessionPost }) {
  return sessionPost
    ? `/app/huddle?postId=${sessionPost._id.toHexString()}&teamId=${teamId}`
    : `/app/profile/${userId}?tab=work`;
}

/**
 * Send a clock-out notice at most once per recipient and session, so finishing
 * a clock-out that was interrupted (and so runs again) never repeats one.
 */
async function createClockOutNoticeOnce(notice) {
  const sent = await notifications().findOne({
    userId: notice.userId,
    'data.type': notice.data.type,
    'data.clockEventId': notice.data.clockEventId,
  });
  if (!sent) await createNotification(notice);
}

/**
 * Tell a team's admins (and, for a manual clock-out, the member) that a
 * member clocked out. Links to the session's Huddle post when it has one,
 * else the member's Work tab. An `auto` clock-out skips the member's own
 * notice: the 8h job sends its own. Each notice carries the session's
 * `clockEventId` and goes out once. Returns the member's display name.
 */
export async function notifyClockOut({
  userId,
  teamId,
  clockEventId,
  team,
  accumulatedTime,
  sessionPost,
  auto = false,
}) {
  const userName = await userDisplayName(userId);
  const totalSecs = accumulatedTime ?? 0;
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const durationText = h > 0 ? `${h}h ${m}m` : `${m}m`;
  const url = clockOutUrl({ userId, teamId, sessionPost });
  const adminBody = auto
    ? `${userName} was automatically clocked out of ${team.name} after 8 hours (${durationText})`
    : `${userName} clocked out of ${team.name} (${durationText})`;

  await Promise.all(
    (team.admins ?? [])
      .filter((id) => id !== userId)
      .map((adminId) =>
        createClockOutNoticeOnce({
          userId: adminId,
          title: 'Huddle',
          body: adminBody,
          data: {
            type: 'clock-out',
            userId,
            userName,
            teamName: team.name,
            teamId,
            clockEventId,
            duration: durationText,
            url,
          },
        }).catch(() => {})
      )
  );

  if (!auto) {
    createClockOutNoticeOnce({
      userId,
      title: 'Huddle',
      body: `You clocked out of ${team.name} (${durationText})`,
      data: {
        type: 'clock-out-self',
        teamName: team.name,
        teamId,
        clockEventId,
        duration: durationText,
        url,
      },
    }).catch(() => {});
  }
  return userName;
}

/** Resolve a user's display name (better-auth `user` collection). */
export async function userDisplayName(userId) {
  const user = await findUserById(userId);
  return user?.name ?? user?.email?.split('@')[0] ?? 'Someone';
}
