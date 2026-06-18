import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { MongoInternals } from 'meteor/mongo';
import { Teams, Channels, ChannelMessages, rawDb, isValidId } from './collections';
import { requireIdentity, identityForConnection } from './auth-bridge';
import { createNotification } from './notify-core';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

function toPublicChannel(ch) {
  const id = ch._id?.toHexString ? ch._id.toHexString() : String(ch._id);
  return {
    id,
    teamId: ch.teamId,
    name: ch.name,
    ...(ch.description ? { description: ch.description } : {}),
    isDefault: ch.isDefault,
    members: ch.members ?? [],
    createdBy: ch.createdBy,
    createdAt: ch.createdAt instanceof Date ? ch.createdAt.toISOString() : String(ch.createdAt),
  };
}

function toPublicChannelMessage(m) {
  const id = m._id?.toHexString ? m._id.toHexString() : String(m._id);
  return {
    id,
    channelId: m.channelId,
    teamId: m.teamId,
    fromUserId: m.fromUserId,
    senderName: m.senderName,
    text: m.text,
    createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : String(m.createdAt),
  };
}

export async function ensureDefaultChannel(teamId, createdBy) {
  const existing = await Channels.rawCollection().findOne({ teamId, isDefault: true });
  if (existing) return;
  await Channels.rawCollection().insertOne({
    _id: new ObjectId(),
    teamId,
    name: 'general',
    description: 'General team discussion',
    isDefault: true,
    createdBy,
    createdAt: new Date(),
  });
}

function hasChannelAccess(channel, userId) {
  return !channel.members || channel.members.length === 0 || channel.members.includes(userId);
}

Meteor.publish('channelmessages.byChannel', function (channelId, teamId) {
  const identity = identityForConnection(this.connection);
  if (!identity) return this.ready();
  if (typeof channelId !== 'string' || typeof teamId !== 'string') return this.ready();
  return ChannelMessages.find({ channelId }, { sort: { createdAt: -1 }, limit: 100 });
});

Meteor.methods({
  async 'channels.list'({ teamId }) {
    const identity = await requireIdentity(this);
    if (!isValidId(teamId)) throw new Meteor.Error('bad-request', 'Invalid teamId');

    const team = await Teams.findOneAsync(new Mongo.ObjectID(teamId));
    if (!team) throw new Meteor.Error('forbidden', 'Team not found');
    const allMembers = [...team.members, ...(team.admins || [])];
    if (!allMembers.includes(identity.userId)) {
      throw new Meteor.Error('forbidden', 'Not a team member');
    }

    let allChannels = await Channels.rawCollection()
      .find({ teamId })
      .sort({ isDefault: -1, createdAt: 1 })
      .toArray();

    if (allChannels.length === 0) {
      await ensureDefaultChannel(teamId, identity.userId);
      allChannels = await Channels.rawCollection()
        .find({ teamId })
        .sort({ isDefault: -1, createdAt: 1 })
        .toArray();
    }

    const visible = allChannels.filter((ch) => hasChannelAccess(ch, identity.userId));
    return { channels: visible.map(toPublicChannel) };
  },

  async 'channels.create'({ teamId, name, description, members }) {
    const identity = await requireIdentity(this);
    if (!isValidId(teamId)) throw new Meteor.Error('bad-request', 'Invalid teamId');
    if (typeof name !== 'string' || !name.trim()) {
      throw new Meteor.Error('bad-request', 'name is required');
    }

    const team = await Teams.findOneAsync(new Mongo.ObjectID(teamId));
    if (!team) throw new Meteor.Error('not-found', 'Team not found');
    const allTeamMembers = [...team.members, ...(team.admins || [])];
    if (!allTeamMembers.includes(identity.userId)) {
      throw new Meteor.Error('forbidden', 'Not a team member');
    }

    const cleanName = name.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-').slice(0, 50);
    const existing = await Channels.rawCollection().findOne({ teamId, name: cleanName });
    if (existing) throw new Meteor.Error('duplicate', 'Channel name already exists');

    let channelMembers;
    if (members && members.length > 0) {
      const validIds = members.filter((id) => allTeamMembers.includes(id));
      if (!validIds.includes(identity.userId)) validIds.push(identity.userId);
      channelMembers = validIds;
    }

    const doc = {
      _id: new ObjectId(),
      teamId,
      name: cleanName,
      ...(description?.trim() ? { description: description.trim() } : {}),
      isDefault: false,
      ...(channelMembers ? { members: channelMembers } : {}),
      createdBy: identity.userId,
      createdAt: new Date(),
    };
    await Channels.rawCollection().insertOne(doc);
    return { channel: toPublicChannel(doc) };
  },

  async 'channels.getMessages'({ channelId, teamId, before, limit }) {
    const identity = await requireIdentity(this);
    if (!isValidId(teamId) || !isValidId(channelId)) {
      throw new Meteor.Error('bad-request', 'Invalid channelId or teamId');
    }

    const team = await Teams.findOneAsync(new Mongo.ObjectID(teamId));
    if (!team) throw new Meteor.Error('forbidden', 'Team not found');
    if (![...team.members, ...(team.admins || [])].includes(identity.userId)) {
      throw new Meteor.Error('forbidden', 'Not a team member');
    }

    const channel = await Channels.rawCollection().findOne({
      _id: new ObjectId(channelId),
      teamId,
    });
    if (!channel) throw new Meteor.Error('forbidden', 'Channel not found');
    if (!hasChannelAccess(channel, identity.userId)) {
      throw new Meteor.Error('forbidden', 'No access to this channel');
    }

    const safeLimit = Math.min(Math.max(1, limit ?? 50), 100);
    const filter = { channelId };
    if (before) {
      const ts = new Date(before);
      if (!isNaN(ts.getTime())) filter.createdAt = { $lt: ts };
    }

    const messages = await ChannelMessages.rawCollection()
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(safeLimit + 1)
      .toArray();
    const hasMore = messages.length > safeLimit;
    if (hasMore) messages.pop();
    messages.reverse();
    return { messages: messages.map(toPublicChannelMessage), hasMore };
  },

  async 'channels.sendMessage'({ channelId, teamId, text }) {
    const identity = await requireIdentity(this);
    if (!isValidId(teamId) || !isValidId(channelId)) {
      throw new Meteor.Error('bad-request', 'Invalid channelId or teamId');
    }
    if (typeof text !== 'string' || !text.trim()) {
      throw new Meteor.Error('bad-request', 'text is required');
    }

    const team = await Teams.findOneAsync(new Mongo.ObjectID(teamId));
    if (!team) throw new Meteor.Error('not-found', 'Team not found');
    const allTeamMembers = [...team.members, ...(team.admins || [])];
    if (!allTeamMembers.includes(identity.userId)) {
      throw new Meteor.Error('forbidden', 'Not a team member');
    }

    const channel = await Channels.rawCollection().findOne({
      _id: new ObjectId(channelId),
      teamId,
    });
    if (!channel) throw new Meteor.Error('not-found', 'Channel not found');
    if (!hasChannelAccess(channel, identity.userId)) {
      throw new Meteor.Error('forbidden', 'No access to this channel');
    }

    const sender = await rawDb().collection('user').findOne({ _id: new ObjectId(identity.userId) });
    const senderName = sender?.name ?? sender?.email?.split('@')[0] ?? 'Unknown';

    const doc = {
      _id: new ObjectId(),
      channelId,
      teamId,
      fromUserId: identity.userId,
      senderName,
      text,
      createdAt: new Date(),
    };
    await ChannelMessages.rawCollection().insertOne(doc);

    const recipientIds = (
      channel.members && channel.members.length > 0 ? channel.members : allTeamMembers
    ).filter((id) => id !== identity.userId);

    const truncatedText = text.length > 200 ? text.slice(0, 197) + '…' : text;
    for (const recipientId of recipientIds) {
      createNotification({
        userId: recipientId,
        title: `${senderName} in #${channel.name}`,
        body: truncatedText,
        data: { type: 'channel_message', teamId, channelId, senderName, url: '/app/messages' },
      }).catch((err) => console.error('[channel] notification failed:', err));
    }

    return { message: toPublicChannelMessage(doc) };
  },
});
