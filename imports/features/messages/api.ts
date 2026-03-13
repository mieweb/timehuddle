import { DDPRateLimiter } from 'meteor/ddp-rate-limiter';
import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';

import { Notifications, Teams } from '../teams/api';
import { sendMessageSchema, type MessageDoc } from './schema';

// ─── Collections ──────────────────────────────────────────────────────────────

export const Messages = new Mongo.Collection<MessageDoc>('messages');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildThreadId(teamId: string, adminId: string, memberId: string): string {
  return `${teamId}:${adminId}:${memberId}`;
}

function getUserDisplayName(user: Meteor.User, fallback = 'Unknown'): string {
  const p = user.profile as { firstName?: string; lastName?: string } | undefined;
  if (p?.firstName || p?.lastName) return [p.firstName, p.lastName].filter(Boolean).join(' ');
  return user.emails?.[0]?.address?.split('@')[0] ?? fallback;
}

// ─── Server ───────────────────────────────────────────────────────────────────

if (Meteor.isServer) {
  Meteor.startup(async () => {
    await Messages.createIndexAsync({ threadId: 1, createdAt: 1 });
    await Messages.createIndexAsync({ teamId: 1 });

    DDPRateLimiter.addRule(
      { name: (n) => n === 'messages.send', userId: () => true },
      20,
      60_000,
    );
  });

  // ─── Publications ────────────────────────────────────────────────────────────

  Meteor.publish('messages.thread', function (teamId: string, adminId: string, memberId: string) {
    if (!this.userId) return this.ready();
    const threadId = buildThreadId(teamId, adminId, memberId);
    // Only allow participants to read
    if (this.userId !== adminId && this.userId !== memberId) return this.ready();
    return Messages.find({ threadId }, { sort: { createdAt: 1 } });
  });

  // ─── Methods ──────────────────────────────────────────────────────────────────

  Meteor.methods({
    async 'messages.send'(fields: {
      teamId: string;
      toUserId: string;
      text: string;
      adminId: string;
      ticketId?: string;
    }) {
      if (!this.userId) throw new Meteor.Error('not-authorized');
      const result = sendMessageSchema.safeParse(fields);
      if (!result.success)
        throw new Meteor.Error('validation', result.error.issues[0]?.message ?? 'Invalid');
      const { teamId, toUserId, text, adminId, ticketId } = result.data;

      const team = await Teams.findOneAsync(teamId);
      if (!team) throw new Meteor.Error('not-found', 'Team not found');

      const isAdmin = team.admins.includes(this.userId);
      const isMember = team.members.includes(this.userId);
      if (!isAdmin && !isMember) throw new Meteor.Error('not-authorized', 'Not a team member');

      const memberId = isAdmin ? toUserId : this.userId;
      const threadId = buildThreadId(teamId, adminId, memberId);

      // Sender must be one of the thread participants
      if (this.userId !== adminId && this.userId !== memberId)
        throw new Meteor.Error('not-authorized', 'Invalid thread');
      if (!team.admins.includes(adminId))
        throw new Meteor.Error('not-authorized', 'Admin not in team');
      const allMembers = [...team.members, ...team.admins];
      if (!allMembers.includes(memberId))
        throw new Meteor.Error('not-authorized', 'Member not in team');

      const fromUser = await Meteor.users.findOneAsync(this.userId);
      const senderName = fromUser ? getUserDisplayName(fromUser) : 'Unknown';

      const doc: Omit<MessageDoc, '_id'> = {
        threadId,
        teamId,
        adminId,
        memberId,
        fromUserId: this.userId,
        toUserId,
        text,
        senderName,
        createdAt: new Date(),
      };
      if (ticketId) (doc as MessageDoc).ticketId = ticketId;

      const messageId = await Messages.insertAsync(doc as MessageDoc);

      // Create in-app notification for recipient
      await Notifications.insertAsync({
        userId: toUserId,
        title: 'TimeHuddle',
        body: `${senderName}: ${text}`,
        data: { type: 'message', teamId, threadId, ticketId: ticketId || null },
        read: false,
        createdAt: new Date(),
      });

      return messageId;
    },
  });
}
