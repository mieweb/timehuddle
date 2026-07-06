import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { MongoInternals } from 'meteor/mongo';
import { Teams, Messages, rawDb, isValidId } from './collections';
import { requireIdentity } from './auth-bridge';
import { createNotification } from './notify-core';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

function buildThreadId(teamId, adminId, memberId) {
  return `${teamId}:${adminId}:${memberId}`;
}

function toPublicMessage(m) {
  const id = m._id?.toHexString ? m._id.toHexString() : String(m._id);
  return {
    id,
    threadId: m.threadId,
    teamId: m.teamId,
    adminId: m.adminId,
    memberId: m.memberId,
    fromUserId: m.fromUserId,
    toUserId: m.toUserId,
    text: m.text,
    senderName: m.senderName,
    ...(m.ticketId ? { ticketId: m.ticketId } : {}),
    createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : String(m.createdAt),
  };
}

Meteor.publish('messages.byThread', function (threadId) {
  if (!this.userId) return this.ready();
  const userId = this.userId;
  if (typeof threadId !== 'string') return this.ready();
  const parts = threadId.split(':');
  if (parts.length !== 3) return this.ready();
  const [, adminId, memberId] = parts;
  if (userId !== adminId && userId !== memberId) return this.ready();
  return Messages.find({ threadId }, { sort: { createdAt: -1 }, limit: 100 });
});

Meteor.methods({
  async 'messages.getThread'({ teamId, adminId, memberId, before, limit }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (userId !== adminId && userId !== memberId) {
      throw new Meteor.Error('forbidden', 'Not a thread participant');
    }

    const threadId = buildThreadId(teamId, adminId, memberId);
    const safeLimit = Math.min(Math.max(1, limit ?? 50), 100);
    const filter = { threadId };
    if (before) {
      const ts = new Date(before);
      if (!isNaN(ts.getTime())) filter.createdAt = { $lt: ts };
    }

    const messages = await Messages.rawCollection()
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(safeLimit + 1)
      .toArray();
    const hasMore = messages.length > safeLimit;
    if (hasMore) messages.pop();
    messages.reverse();
    return { messages: messages.map(toPublicMessage), hasMore };
  },

  async 'messages.send'({ teamId, toUserId, text, adminId, ticketId }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (typeof text !== 'string' || !text.trim()) {
      throw new Meteor.Error('bad-request', 'text is required');
    }
    if (!isValidId(teamId)) throw new Meteor.Error('bad-request', 'Invalid teamId');

    const team = await Teams.findOneAsync(new Mongo.ObjectID(teamId));
    if (!team) throw new Meteor.Error('not-found', 'Team not found');

    const isAdmin = team.admins.includes(userId);
    const isMember = team.members.includes(userId);
    if (!isAdmin && !isMember) throw new Meteor.Error('forbidden', 'Not a team member');

    const memberId = isAdmin ? toUserId : userId;
    const threadId = buildThreadId(teamId, adminId, memberId);

    if (userId !== adminId && userId !== memberId) {
      throw new Meteor.Error('forbidden', 'Not a thread participant');
    }
    if (!team.admins.includes(adminId)) {
      throw new Meteor.Error('forbidden', 'adminId is not a team admin');
    }
    const allMembers = [...team.members, ...team.admins];
    if (!allMembers.includes(memberId)) {
      throw new Meteor.Error('forbidden', 'memberId is not a team member');
    }

    const sender = await rawDb().collection('users').findOne({ _id: String(userId) });
    const senderName = sender?.profile?.name ?? sender?.emails?.[0]?.address?.split('@')[0] ?? 'Unknown';

    const doc = {
      _id: new ObjectId(),
      threadId,
      teamId,
      adminId,
      memberId,
      fromUserId: userId,
      toUserId,
      text,
      senderName,
      createdAt: new Date(),
    };
    if (ticketId) doc.ticketId = ticketId;

    await Messages.rawCollection().insertOne(doc);

    const truncatedText = text.length > 200 ? text.slice(0, 197) + '…' : text;
    createNotification({
      userId: toUserId,
      title: `New message from ${senderName}`,
      body: truncatedText,
      data: {
        type: 'message',
        teamId,
        adminId,
        memberId,
        senderName,
        url: `/app/messages?openTeam=${encodeURIComponent(teamId)}&openPeer=${encodeURIComponent(userId)}`,
      },
    }).catch((err) => console.error('[message] notification failed:', err));

    return { message: toPublicMessage(doc) };
  },
});
