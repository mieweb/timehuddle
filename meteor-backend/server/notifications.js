/**
 * Notifications — reactive inbox publication for the current user.
 *
 * During Fastify coexistence, Fastify remains the notification *writer* (team
 * invites, messages, shift reminders) and owns push fan-out. This module only
 * replaces the `/v1/notifications/ws` SSE-style stream with an oplog-backed DDP
 * publication, mirroring `clock.liveForTeams` and `timers.liveForUser`.
 *
 * Publishing the user's recent inbox (newest first, capped) lets the frontend
 * react to every new notification — whether written by Fastify, the Meteor
 * agenda processor, or mongosh — without polling. Mutations (mark read, delete,
 * invite/shift responses) stay on Fastify REST for now.
 */
import { Meteor } from 'meteor/meteor';
import { MongoInternals } from 'meteor/mongo';
import { Notifications } from './collections';
import { rawDb } from './collections';
import { requireIdentity } from './auth-bridge.js';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

// Safe ObjectId conversion — only converts 24-char hex strings
function toId(id) {
  return /^[a-f0-9]{24}$/i.test(id) ? new ObjectId(id) : id;
}

const INBOX_LIMIT = 200;

Meteor.publish('notifications.liveForUser', function () {
  if (!this.userId) return this.ready();
  const userId = this.userId;
  return Notifications.find(
    { userId: userId },
    { sort: { createdAt: -1 }, limit: INBOX_LIMIT }
  );
});

// ─── Meteor Methods ───────────────────────────────────────────────────────────

Meteor.methods({
  async 'notifications.getInbox'() {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    const docs = await rawDb().collection('notifications')
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();
    return {
      notifications: docs.map((n) => ({
        id: n._id.toHexString ? n._id.toHexString() : String(n._id),
        userId: n.userId,
        title: n.title,
        body: n.body,
        data: n.data ?? n.notificationData ?? {},
        read: n.read ?? false,
        createdAt: n.createdAt instanceof Date
          ? n.createdAt.toISOString() : String(n.createdAt),
      }))
    };
  },

  async 'notifications.markOneRead'({ notificationId }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!notificationId) throw new Meteor.Error('bad-request', 'notificationId required');
    await rawDb().collection('notifications').updateOne(
      { _id: toId(notificationId), userId },
      { $set: { read: true } }
    );
    return { ok: true };
  },

  async 'notifications.markAllRead'() {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    await rawDb().collection('notifications').updateMany(
      { userId, read: false },
      { $set: { read: true } }
    );
    return { ok: true };
  },

  async 'notifications.deleteMany'({ ids }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new Meteor.Error('bad-request', 'ids array required');
    }
    const objectIds = ids.map((id) => toId(id));
    const result = await rawDb().collection('notifications').deleteMany({
      _id: { $in: objectIds },
      userId,
    });
    return { deletedCount: result.deletedCount };
  },

  async 'notifications.getInvitePreview'({ notificationId }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!notificationId) throw new Meteor.Error('bad-request', 'notificationId required');
    const notification = await rawDb().collection('notifications')
      .findOne({ _id: toId(notificationId), userId });
    if (!notification) throw new Meteor.Error('not-found', 'Notification not found');
    const teamId = notification.data?.teamId ?? notification.notificationData?.teamId;
    if (!teamId) throw new Meteor.Error('bad-request', 'No teamId in notification');
    const team = await rawDb().collection('teams').findOne({ _id: teamId });
    if (!team) throw new Meteor.Error('not-found', 'Team not found');
    const inviterId = notification.data?.inviterId ?? notification.notificationData?.inviterId;
    let inviter = null;
    if (inviterId) {
      const u = await rawDb().collection('users').findOne({ _id: String(inviterId) })
        ?? await rawDb().collection('user').findOne({ _id: toId(inviterId) });
      if (u) inviter = { id: inviterId, name: u.profile?.name ?? u.name, email: u.emails?.[0]?.address ?? u.email };
    }
    const memberIds = [...(team.members ?? []), ...(team.admins ?? [])];
    const members = await Promise.all(memberIds.slice(0, 5).map(async (uid) => {
      const u = await rawDb().collection('users').findOne({ _id: String(uid) })
        ?? await rawDb().collection('user').findOne({ _id: toId(uid) });
      return u ? { id: uid, name: u.profile?.name ?? u.name, email: u.emails?.[0]?.address ?? u.email } : null;
    }));
    const alreadyMember = memberIds.includes(userId);
    return {
      notificationId,
      teamId,
      teamName: team.name,
      teamDescription: team.description ?? '',
      inviter,
      members: members.filter(Boolean),
      admins: [],
      alreadyMember,
    };
  },

  async 'notifications.respondToInvite'({ notificationId, action }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!notificationId) throw new Meteor.Error('bad-request', 'notificationId required');
    if (!['join', 'ignore'].includes(action)) throw new Meteor.Error('bad-request', 'action must be join or ignore');
    const notification = await rawDb().collection('notifications')
      .findOne({ _id: toId(notificationId), userId });
    if (!notification) throw new Meteor.Error('not-found', 'Notification not found');
    const teamId = notification.data?.teamId ?? notification.notificationData?.teamId;
    if (action === 'join' && teamId) {
      await rawDb().collection('teams').updateOne(
        { _id: teamId },
        { $addToSet: { members: userId } }
      );
    }
    await rawDb().collection('notifications').updateOne(
      { _id: toId(notificationId) },
      { $set: { read: true } }
    );
    return { ok: true };
  },

  async 'notifications.testPush'() {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    // Insert a test notification for the current user
    await rawDb().collection('notifications').insertOne({
      _id: new ObjectId(),
      userId,
      title: 'Test Push',
      body: 'This is a test push notification',
      read: false,
      data: { type: 'test' },
      createdAt: new Date(),
    });
    return { ok: true };
  },
});
