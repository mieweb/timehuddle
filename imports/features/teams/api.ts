import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';

import {
  type NotificationDoc,
  type TeamDoc,
} from './schema';

// ─── Collections ──────────────────────────────────────────────────────────────

export const Teams = new Mongo.Collection<TeamDoc>('teams');
export const Notifications = new Mongo.Collection<NotificationDoc>('notifications');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function idStr(id: unknown): string {
  if (id == null) return '';
  if (typeof id === 'string') return id;
  const o = id as { _str?: string; toHexString?: () => string };
  return o._str ?? o.toHexString?.() ?? String(id);
}

function getUserDisplayName(user: Meteor.User, fallback = 'Unknown'): string {
  const p = user.profile as { firstName?: string; lastName?: string } | undefined;
  if (p?.firstName || p?.lastName) return [p.firstName, p.lastName].filter(Boolean).join(' ');
  return user.emails?.[0]?.address?.split('@')[0] ?? fallback;
}

type BasicUserInfo = { id: string; name: string; email: string };

async function getBasicUsers(userIds: string[]): Promise<BasicUserInfo[]> {
  if (!userIds.length) return [];
  const users = await Meteor.users.find({ _id: { $in: userIds } }).fetchAsync();
  return users.map((u) => ({
    id: u._id,
    name: getUserDisplayName(u),
    email: u.emails?.[0]?.address ?? '',
  }));
}

// ─── Server ───────────────────────────────────────────────────────────────────

if (Meteor.isServer) {
  Meteor.startup(async () => {
    await Notifications.createIndexAsync({ userId: 1, createdAt: -1 });
  });

  // ─── Publications ────────────────────────────────────────────────────────────

  Meteor.publish('notifications.inbox', function () {
    if (!this.userId) return this.ready();
    return Notifications.find({ userId: this.userId }, { sort: { createdAt: -1 }, limit: 200 });
  });

  // ─── Methods ──────────────────────────────────────────────────────────────────

  Meteor.methods({
    async 'notifications.markAsRead'(notificationId: unknown) {
      if (!this.userId) throw new Meteor.Error('not-authorized');
      if (notificationId === undefined || notificationId === null) {
        throw new Meteor.Error('invalid-argument', 'notificationId is required');
      }
      const targetId = idStr(notificationId);
      const notifications = await Notifications.find({ userId: this.userId }, { fields: { _id: 1 } }).fetchAsync();
      const match = notifications.find((n) => idStr(n._id) === targetId);
      if (!match?._id) return;
      await Notifications.updateAsync(match._id, { $set: { read: true } });
    },

    async 'notifications.markAllAsRead'() {
      if (!this.userId) throw new Meteor.Error('not-authorized');
      await Notifications.updateAsync(
        { userId: this.userId, read: false },
        { $set: { read: true } },
        { multi: true },
      );
    },

    async 'notifications.delete'(notificationIds: unknown) {
      if (!this.userId) throw new Meteor.Error('not-authorized');
      const idsInput = Array.isArray(notificationIds) ? notificationIds : [notificationIds];
      if (!idsInput.length) {
        throw new Meteor.Error('invalid-argument', 'No notification IDs provided');
      }
      const requestedIds = new Set(idsInput.map((id) => idStr(id)).filter(Boolean));
      const userNotifications = await Notifications.find({ userId: this.userId }, { fields: { _id: 1 } }).fetchAsync();
      const removableIds = userNotifications
        .filter((n) => requestedIds.has(idStr(n._id)))
        .map((n) => n._id!)
        .filter(Boolean);
      if (removableIds.length === 0) return { success: true as const, deletedCount: 0 };
      const result = await Notifications.removeAsync({ _id: { $in: removableIds }, userId: this.userId });
      return { success: true as const, deletedCount: result };
    },

    async 'notifications.getTeamInvitePreview'(notificationId: unknown) {
      if (!this.userId) throw new Meteor.Error('not-authorized');
      const targetId = idStr(notificationId);
      if (!targetId) throw new Meteor.Error('invalid-argument', 'notificationId is required');

      const notifications = await Notifications.find({ userId: this.userId }).fetchAsync();
      const invite = notifications.find((n) => idStr(n._id) === targetId);
      if (!invite) throw new Meteor.Error('not-found', 'Invite not found');

      const data = (invite.data ?? {}) as Record<string, unknown>;
      if (data.type !== 'team-invite') {
        throw new Meteor.Error('bad-request', 'Notification is not a team invite');
      }

      const teamId = typeof data.teamId === 'string' ? data.teamId : '';
      const inviterId = typeof data.inviterId === 'string' ? data.inviterId : '';
      if (!teamId) throw new Meteor.Error('bad-request', 'Invalid invite data');

      const team = await Teams.findOneAsync(teamId);
      if (!team) throw new Meteor.Error('not-found', 'Team not found');

      const memberIds = Array.from(new Set(team.members));
      const adminIds = Array.from(new Set(team.admins));
      const allIds = Array.from(new Set([...memberIds, ...adminIds]));
      const users = await getBasicUsers(allIds);
      const userMap = new Map(users.map((u) => [u.id, u]));
      const inviter = userMap.get(inviterId) ?? null;

      return {
        notificationId: targetId,
        teamId: team._id!,
        teamName: team.name,
        teamDescription: team.description ?? '',
        inviter,
        members: memberIds.map((id) => userMap.get(id) ?? { id, name: 'Unknown', email: '' }),
        admins: adminIds.map((id) => userMap.get(id) ?? { id, name: 'Unknown', email: '' }),
        alreadyMember: team.members.includes(this.userId),
      };
    },

    async 'notifications.respondToTeamInvite'(fields: { notificationId: unknown; action: 'join' | 'ignore' }) {
      if (!this.userId) throw new Meteor.Error('not-authorized');
      const notificationId = idStr(fields?.notificationId);
      const action = fields?.action;
      if (!notificationId || (action !== 'join' && action !== 'ignore')) {
        throw new Meteor.Error('invalid-argument', 'Invalid invite response');
      }

      const notifications = await Notifications.find({ userId: this.userId }).fetchAsync();
      const invite = notifications.find((n) => idStr(n._id) === notificationId);
      if (!invite) throw new Meteor.Error('not-found', 'Invite not found');

      const data = (invite.data ?? {}) as Record<string, unknown>;
      if (data.type !== 'team-invite') throw new Meteor.Error('bad-request', 'Notification is not a team invite');

      if (action === 'join') {
        const teamCode = typeof data.teamCode === 'string' ? data.teamCode : '';
        const teamId = typeof data.teamId === 'string' ? data.teamId : '';
        if (!teamCode && !teamId) throw new Meteor.Error('bad-request', 'Invalid invite data');

        const team = teamCode
          ? await Teams.findOneAsync({ code: teamCode })
          : await Teams.findOneAsync(teamId);

        if (!team) throw new Meteor.Error('not-found', 'Team not found');
        if (!team.members.includes(this.userId)) {
          await Teams.updateAsync(team._id!, { $push: { members: this.userId } });
        }
      }

      await Notifications.removeAsync({ _id: invite._id, userId: this.userId });
      return { success: true as const };
    },
  });
}
