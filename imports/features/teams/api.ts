import { Accounts } from 'meteor/accounts-base';
import { DDPRateLimiter } from 'meteor/ddp-rate-limiter';
import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';

import {
  createTeamSchema,
  inviteTeamMemberSchema,
  joinTeamSchema,
  setTeamMemberPasswordSchema,
  teamMemberActionSchema,
  updateTeamNameSchema,
  type NotificationDoc,
  type TeamDoc,
} from './schema';

// ─── Collections ──────────────────────────────────────────────────────────────

export const Teams = new Mongo.Collection<TeamDoc>('teams');
export const Notifications = new Mongo.Collection<NotificationDoc>('notifications');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateTeamCode(): string {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

function getUserDisplayName(user: Meteor.User, fallback = 'Unknown'): string {
  const p = user.profile as { firstName?: string; lastName?: string } | undefined;
  if (p?.firstName || p?.lastName) return [p.firstName, p.lastName].filter(Boolean).join(' ');
  return user.emails?.[0]?.address?.split('@')[0] ?? fallback;
}

async function requireTeamAdmin(teamId: string, userId: string): Promise<TeamDoc> {
  const team = await Teams.findOneAsync(teamId);
  if (!team) throw new Meteor.Error('not-found', 'Team not found');
  if (!team.admins.includes(userId)) throw new Meteor.Error('forbidden', 'Only admins can perform this action');
  return team;
}

async function ensurePersonalWorkspace(userId: string): Promise<string> {
  const existing = await Teams.findOneAsync({ isPersonal: true, members: userId, admins: userId });
  if (existing) return existing._id!;
  const code = generateTeamCode();
  return await Teams.insertAsync({
    name: 'Personal',
    members: [userId],
    admins: [userId],
    code,
    isPersonal: true,
    createdAt: new Date(),
  });
}

// ─── Server ───────────────────────────────────────────────────────────────────

if (Meteor.isServer) {
  Meteor.startup(async () => {
    await Teams.createIndexAsync({ members: 1 });
    await Teams.createIndexAsync({ code: 1 }, { unique: true });
    await Notifications.createIndexAsync({ userId: 1, createdAt: -1 });

    const methodNames = [
      'teams.ensurePersonalWorkspace',
      'teams.create',
      'teams.join',
      'teams.updateName',
      'teams.delete',
      'teams.addAdmin',
      'teams.removeAdmin',
      'teams.removeMember',
      'teams.invite',
      'teams.setMemberPassword',
      'teams.getUsers',
    ];
    DDPRateLimiter.addRule({ name: (n) => methodNames.includes(n), userId: () => true }, 20, 60_000);
  });

  // ─── Publications ────────────────────────────────────────────────────────────

  Meteor.publish('userTeams', function () {
    if (!this.userId) return this.ready();
    return Teams.find({ members: this.userId });
  });

  Meteor.publish('teamDetails', function (teamId: string) {
    if (!this.userId) return this.ready();
    return Teams.find({ _id: teamId, members: this.userId });
  });

  Meteor.publish('teamMembers', async function (teamId: string) {
    if (!this.userId) return this.ready();
    const team = await Teams.findOneAsync({ _id: teamId, members: this.userId });
    if (!team) return this.ready();
    const allIds = [...new Set([...team.members, ...team.admins])];
    return Meteor.users.find(
      { _id: { $in: allIds } },
      { fields: { 'emails.address': 1, profile: 1 } },
    );
  });

  Meteor.publish('notifications.inbox', function () {
    if (!this.userId) return this.ready();
    return Notifications.find({ userId: this.userId }, { sort: { createdAt: -1 }, limit: 200 });
  });

  // ─── Methods ──────────────────────────────────────────────────────────────────

  Meteor.methods({
    async 'teams.ensurePersonalWorkspace'() {
      if (!this.userId) throw new Meteor.Error('not-authorized');
      return await ensurePersonalWorkspace(this.userId);
    },

    async 'teams.create'(fields: { name: string }) {
      if (!this.userId) throw new Meteor.Error('not-authorized');
      const result = createTeamSchema.safeParse(fields);
      if (!result.success) throw new Meteor.Error('validation', result.error.issues[0]?.message ?? 'Invalid input');
      const code = generateTeamCode();
      const teamId = await Teams.insertAsync({
        name: result.data.name,
        members: [this.userId],
        admins: [this.userId],
        code,
        createdAt: new Date(),
      });
      return { teamId, code };
    },

    async 'teams.join'(fields: { teamCode: string }) {
      if (!this.userId) throw new Meteor.Error('not-authorized');
      const result = joinTeamSchema.safeParse(fields);
      if (!result.success) throw new Meteor.Error('validation', result.error.issues[0]?.message ?? 'Invalid input');
      const team = await Teams.findOneAsync({ code: result.data.teamCode });
      if (!team) throw new Meteor.Error('not-found', 'Team not found');
      if (team.members.includes(this.userId)) throw new Meteor.Error('already-member', 'You are already a member of this team');
      await Teams.updateAsync(team._id!, { $push: { members: this.userId } });
      return team._id;
    },

    async 'teams.updateName'(fields: { teamId: string; newName: string }) {
      if (!this.userId) throw new Meteor.Error('not-authorized');
      const result = updateTeamNameSchema.safeParse(fields);
      if (!result.success) throw new Meteor.Error('validation', result.error.issues[0]?.message ?? 'Invalid input');
      await requireTeamAdmin(result.data.teamId, this.userId);
      await Teams.updateAsync(result.data.teamId, { $set: { name: result.data.newName } });
    },

    async 'teams.delete'(teamId: string) {
      if (!this.userId) throw new Meteor.Error('not-authorized');
      await requireTeamAdmin(teamId, this.userId);
      await Teams.removeAsync(teamId);
    },

    async 'teams.addAdmin'(fields: { teamId: string; userId: string }) {
      if (!this.userId) throw new Meteor.Error('not-authorized');
      const result = teamMemberActionSchema.safeParse(fields);
      if (!result.success) throw new Meteor.Error('validation', result.error.issues[0]?.message ?? 'Invalid input');
      const team = await requireTeamAdmin(result.data.teamId, this.userId);
      if (!team.members.includes(result.data.userId)) throw new Meteor.Error('bad-request', 'User is not a member of this team');
      await Teams.updateAsync(result.data.teamId, { $addToSet: { admins: result.data.userId } });
    },

    async 'teams.removeAdmin'(fields: { teamId: string; userId: string }) {
      if (!this.userId) throw new Meteor.Error('not-authorized');
      const result = teamMemberActionSchema.safeParse(fields);
      if (!result.success) throw new Meteor.Error('validation', result.error.issues[0]?.message ?? 'Invalid input');
      const team = await requireTeamAdmin(result.data.teamId, this.userId);
      const remaining = team.admins.filter((id) => id !== result.data.userId);
      if (remaining.length === 0) throw new Meteor.Error('bad-request', 'Team must have at least one admin');
      await Teams.updateAsync(result.data.teamId, { $set: { admins: remaining } });
    },

    async 'teams.removeMember'(fields: { teamId: string; userId: string }) {
      if (!this.userId) throw new Meteor.Error('not-authorized');
      const result = teamMemberActionSchema.safeParse(fields);
      if (!result.success) throw new Meteor.Error('validation', result.error.issues[0]?.message ?? 'Invalid input');
      const team = await requireTeamAdmin(result.data.teamId, this.userId);
      if (result.data.userId === this.userId) throw new Meteor.Error('bad-request', 'You cannot remove yourself; use Leave Team');
      if (!team.members.includes(result.data.userId)) throw new Meteor.Error('bad-request', 'User is not a member of this team');
      const remainingAdmins = team.admins.filter((id) => id !== result.data.userId);
      if (remainingAdmins.length === 0) throw new Meteor.Error('bad-request', 'Promote another member to admin first');
      await Teams.updateAsync(result.data.teamId, { $pull: { members: result.data.userId, admins: result.data.userId } });
    },

    async 'teams.invite'(fields: { teamId: string; email: string }) {
      if (!this.userId) throw new Meteor.Error('not-authorized');
      const result = inviteTeamMemberSchema.safeParse(fields);
      if (!result.success) throw new Meteor.Error('validation', result.error.issues[0]?.message ?? 'Invalid input');
      const team = await Teams.findOneAsync(result.data.teamId);
      if (!team) throw new Meteor.Error('not-found', 'Team not found');
      if (!team.members.includes(this.userId)) throw new Meteor.Error('forbidden', 'You must be a member of this team');
      const emailRegex = new RegExp(`^${result.data.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
      const invitedUser = await Meteor.users.findOneAsync({ 'emails.address': emailRegex });
      if (!invitedUser) throw new Meteor.Error('not-found', 'No user found with that email. They need to sign up first.');
      if (team.members.includes(invitedUser._id)) throw new Meteor.Error('already-member', 'Already a member');
      const inviter = await Meteor.users.findOneAsync(this.userId);
      const inviterName = inviter ? getUserDisplayName(inviter) : 'Someone';
      await Notifications.insertAsync({
        userId: invitedUser._id,
        title: 'Team Invite',
        body: `${inviterName} invited you to join "${team.name}" using code "${team.code}"`,
        data: { type: 'team-invite', teamId: team._id, teamCode: team.code, inviterId: this.userId },
        read: false,
        createdAt: new Date(),
      });
      return `Invite sent to ${result.data.email}!`;
    },

    async 'teams.setMemberPassword'(fields: { teamId: string; userId: string; newPassword: string }) {
      if (!this.userId) throw new Meteor.Error('not-authorized');
      const result = setTeamMemberPasswordSchema.safeParse(fields);
      if (!result.success) throw new Meteor.Error('validation', result.error.issues[0]?.message ?? 'Invalid input');
      const team = await requireTeamAdmin(result.data.teamId, this.userId);
      if (!team.members.includes(result.data.userId)) throw new Meteor.Error('bad-request', 'User is not a member');
      const user = await Meteor.users.findOneAsync(result.data.userId);
      if (!user) throw new Meteor.Error('not-found', 'User not found');
      if (typeof Accounts.setPasswordAsync === 'function') {
        await Accounts.setPasswordAsync(result.data.userId, result.data.newPassword, { logout: false });
      } else {
        Accounts.setPassword(result.data.userId, result.data.newPassword, { logout: false });
      }
      return true;
    },

    async 'teams.getUsers'(userIds: string[]) {
      if (!this.userId) throw new Meteor.Error('not-authorized');
      if (!Array.isArray(userIds) || userIds.length === 0) return [];
      const safeIds = userIds.slice(0, 200);
      const users = await Meteor.users.find({ _id: { $in: safeIds } }).fetchAsync();
      return users.map((u) => ({
        id: u._id,
        name: getUserDisplayName(u),
        email: u.emails?.[0]?.address ?? '',
      }));
    },
  });
}
