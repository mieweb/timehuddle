/**
 * Notifications — reactive inbox publication and mutation methods.
 *
 * Meteor methods migrated from Fastify REST to support wormhole-based
 * notification management. All methods require authentication.
 */
import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { MongoInternals } from 'meteor/mongo';
import { Notifications } from './collections';
import { Teams } from './collections';
import { ObjectId } from 'mongodb';

const INBOX_LIMIT = 200;

Meteor.publish('notifications.liveForUser', function () {
  if (!this.userId) return this.ready();
  const userId = this.userId;
  return Notifications.find(
    { userId: userId },
    { sort: { createdAt: -1 }, limit: INBOX_LIMIT }
  );
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toPublicNotification(n) {
  return {
    id: (n._id ?? n.id).toString(),
    userId: n.userId,
    title: n.title,
    body: n.body,
    ...(n.data ? { data: n.data } : {}),
    read: n.read,
    createdAt: n.createdAt.toISOString ? n.createdAt.toISOString() : n.createdAt,
  };
}

// ─── Methods ──────────────────────────────────────────────────────────────────

Meteor.methods({
  'notifications.getInbox'() {
    if (!this.userId) throw new Meteor.Error('unauthorized', 'Not logged in');
    const docs = Notifications.find(
      { userId: this.userId },
      { sort: { createdAt: -1 }, limit: INBOX_LIMIT }
    ).fetch();
    return { notifications: docs.map(toPublicNotification) };
  },

  'notifications.markOneRead'({ notificationId }) {
    check(notificationId, String);
    if (!this.userId) throw new Meteor.Error('unauthorized', 'Not logged in');
    
    if (!ObjectId.isValid(notificationId)) {
      throw new Meteor.Error('not-found', 'Notification not found');
    }
    
    const n = Notifications.findOne({ _id: new ObjectId(notificationId) });
    if (!n) throw new Meteor.Error('not-found', 'Notification not found');
    if (n.userId !== this.userId) throw new Meteor.Error('forbidden', 'Forbidden');
    
    Notifications.update({ _id: new ObjectId(notificationId) }, { $set: { read: true } });
    return { ok: true };
  },

  'notifications.markAllRead'() {
    if (!this.userId) throw new Meteor.Error('unauthorized', 'Not logged in');
    Notifications.update({ userId: this.userId, read: false }, { $set: { read: true } }, { multi: true });
    return { ok: true };
  },

  'notifications.deleteMany'({ ids }) {
    check(ids, [String]);
    if (!this.userId) throw new Meteor.Error('unauthorized', 'Not logged in');
    
    const validIds = ids.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
    if (validIds.length === 0) return { deletedCount: 0 };
    
    const result = Notifications.remove({ _id: { $in: validIds }, userId: this.userId });
    return { deletedCount: result };
  },

  async 'notifications.getInvitePreview'({ notificationId }) {
    check(notificationId, String);
    if (!this.userId) throw new Meteor.Error('unauthorized', 'Not logged in');
    
    if (!ObjectId.isValid(notificationId)) {
      throw new Meteor.Error('not-found', 'Notification not found');
    }
    
    const n = Notifications.findOne({ _id: new ObjectId(notificationId) });
    if (!n) throw new Meteor.Error('not-found', 'Notification not found');
    if (n.userId !== this.userId) throw new Meteor.Error('forbidden', 'Forbidden');
    
    const data = n.data ?? {};
    if (data.type !== 'team-invite') {
      throw new Meteor.Error('bad-request', 'Not a team invite');
    }
    
    const teamId = data.teamId;
    const inviterId = data.inviterId;
    if (!teamId || !ObjectId.isValid(teamId)) {
      throw new Meteor.Error('bad-request', 'Invalid team ID');
    }
    
    const team = Teams.findOne({ _id: new ObjectId(teamId) });
    if (!team) throw new Meteor.Error('not-found', 'Team not found');
    
    const allIds = Array.from(new Set([...team.members, ...team.admins]));
    const db = MongoInternals.defaultRemoteCollectionDriver().mongo.db;
    const users = await db.collection('users').find({ _id: { $in: allIds.filter(id => ObjectId.isValid(id)).map(id => new ObjectId(id)) } }).toArray();
    
    const userMap = new Map(
      users.map((u) => {
        const id = u._id.toString();
        return [
          id,
          {
            id,
            name: u.name ?? u.email?.split('@')[0] ?? 'Unknown',
            email: u.email ?? '',
          },
        ];
      })
    );
    
    return {
      notificationId,
      teamId: team._id.toString(),
      teamName: team.name,
      teamDescription: team.description ?? '',
      inviter: userMap.get(inviterId) ?? null,
      members: team.members.map((id) => userMap.get(id) ?? { id, name: 'Unknown', email: '' }),
      admins: team.admins.map((id) => userMap.get(id) ?? { id, name: 'Unknown', email: '' }),
      alreadyMember: team.members.includes(this.userId),
    };
  },

  'notifications.respondToInvite'({ notificationId, action }) {
    check(notificationId, String);
    check(action, Match.OneOf('join', 'ignore'));
    if (!this.userId) throw new Meteor.Error('unauthorized', 'Not logged in');
    
    if (!ObjectId.isValid(notificationId)) {
      throw new Meteor.Error('not-found', 'Notification not found');
    }
    
    const n = Notifications.findOne({ _id: new ObjectId(notificationId) });
    if (!n) throw new Meteor.Error('not-found', 'Notification not found');
    if (n.userId !== this.userId) throw new Meteor.Error('forbidden', 'Forbidden');
    
    const data = n.data ?? {};
    if (data.type !== 'team-invite') {
      throw new Meteor.Error('bad-request', 'Not a team invite');
    }
    
    if (action === 'join') {
      const teamId = data.teamId;
      if (!teamId || !ObjectId.isValid(teamId)) {
        throw new Meteor.Error('bad-request', 'Invalid team ID');
      }
      
      const team = Teams.findOne({ _id: new ObjectId(teamId) });
      if (!team) throw new Meteor.Error('not-found', 'Team not found');
      
      if (!team.members.includes(this.userId)) {
        Teams.update({ _id: new ObjectId(teamId) }, { $push: { members: this.userId } });
      }
    }
    
    Notifications.remove({ _id: new ObjectId(notificationId), userId: this.userId });
    return { ok: true };
  },
});
