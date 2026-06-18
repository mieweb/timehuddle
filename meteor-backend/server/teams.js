import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { MongoInternals } from 'meteor/mongo';
import { Teams, rawDb, isValidId } from './collections';
import { requireIdentity, identityForConnection } from './auth-bridge';
import { ensureDefaultOrganization, addOrgMember, getAccessibleOrgIds } from './org-helpers';
import { ensureDefaultChannel } from './channels';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

function generateTeamCode() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

function toPublicTeam(team) {
  const id = team._id?.toHexString ? team._id.toHexString() : String(team._id);
  return {
    id,
    orgId: team.orgId,
    parentTeamId: team.parentTeamId ?? null,
    name: team.name,
    description: team.description ?? null,
    members: team.members,
    admins: team.admins,
    code: team.code,
    isPersonal: team.isPersonal ?? false,
    createdAt: team.createdAt instanceof Date ? team.createdAt.toISOString() : String(team.createdAt),
    updatedAt: team.updatedAt instanceof Date ? team.updatedAt.toISOString() : (team.updatedAt ?? null),
  };
}

Meteor.publish('teams.byUser', function () {
  const identity = identityForConnection(this.connection);
  if (!identity) return this.ready();
  return Teams.find({ members: identity.userId });
});

Meteor.methods({
  async 'teams.list'() {
    const identity = await requireIdentity(this);
    const teams = await Teams.find({ members: identity.userId }).fetchAsync();
    return {
      teams: teams.map(toPublicTeam).sort((a, b) => {
        if (a.isPersonal !== b.isPersonal) return a.isPersonal ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
    };
  },

  async 'teams.ensurePersonal'() {
    const identity = await requireIdentity(this);
    const existing = await Teams.findOneAsync({ isPersonal: true, members: identity.userId });
    if (existing) return { team: toPublicTeam(existing) };

    const defaultOrg = await ensureDefaultOrganization();
    const doc = {
      _id: new Mongo.ObjectID(),
      orgId: defaultOrg._id.toHexString(),
      parentTeamId: null,
      name: 'Personal',
      members: [identity.userId],
      admins: [identity.userId],
      code: generateTeamCode(),
      isPersonal: true,
      createdAt: new Date(),
    };
    await Teams.insertAsync(doc);
    ensureDefaultChannel(doc._id.toHexString(), identity.userId).catch(() => {});
    return { team: toPublicTeam(doc) };
  },

  async 'teams.create'({ name, description, orgId: requestedOrgId, parentTeamId }) {
    const identity = await requireIdentity(this);
    if (typeof name !== 'string' || !name.trim()) {
      throw new Meteor.Error('bad-request', 'name is required');
    }

    const accessibleOrgIds = await getAccessibleOrgIds(identity.userId);
    let orgId = requestedOrgId ?? accessibleOrgIds[0] ?? null;

    if (!orgId) {
      const defaultOrg = await ensureDefaultOrganization();
      await addOrgMember(defaultOrg._id.toHexString(), identity.userId, 'member', true);
      orgId = defaultOrg._id.toHexString();
    }

    if (requestedOrgId && !accessibleOrgIds.includes(requestedOrgId)) {
      const defaultOrg = await ensureDefaultOrganization();
      await addOrgMember(defaultOrg._id.toHexString(), identity.userId, 'member', true);
      orgId = defaultOrg._id.toHexString();
    }

    if (parentTeamId) {
      if (!isValidId(parentTeamId)) throw new Meteor.Error('bad-request', 'Invalid parentTeamId');
      const parent = await Teams.findOneAsync(new Mongo.ObjectID(parentTeamId));
      if (!parent || parent.orgId !== orgId) {
        throw new Meteor.Error('bad-request', 'Parent team must exist in the same organization');
      }
    }

    const doc = {
      _id: new Mongo.ObjectID(),
      orgId,
      parentTeamId: parentTeamId ?? null,
      name: name.trim(),
      description: description?.trim() || undefined,
      members: [identity.userId],
      admins: [identity.userId],
      code: generateTeamCode(),
      isPersonal: false,
      createdAt: new Date(),
    };
    await Teams.insertAsync(doc);
    await addOrgMember(orgId, identity.userId, 'member', true);
    ensureDefaultChannel(doc._id.toHexString(), identity.userId).catch(() => {});
    return { team: toPublicTeam(doc) };
  },

  async 'teams.join'({ teamCode }) {
    const identity = await requireIdentity(this);
    if (typeof teamCode !== 'string' || !teamCode.trim()) {
      throw new Meteor.Error('bad-request', 'teamCode is required');
    }

    const team = await Teams.rawCollection().findOne({ code: teamCode.toUpperCase() });
    if (!team) throw new Meteor.Error('not-found', 'Team not found');
    if (team.members.includes(identity.userId)) {
      throw new Meteor.Error('already-member', 'Already a member');
    }

    await Teams.rawCollection().updateOne(
      { _id: team._id },
      { $addToSet: { members: identity.userId }, $set: { updatedAt: new Date() } },
    );

    const db = rawDb();
    const org = team.orgId && isValidId(team.orgId)
      ? await db.collection('organizations').findOne({ _id: new ObjectId(team.orgId) })
      : null;
    if (org?.allowAutoJoin !== false) {
      await addOrgMember(team.orgId, identity.userId, 'member', true);
    }

    const updated = await Teams.rawCollection().findOne({ _id: team._id });
    return { team: toPublicTeam(updated) };
  },

  async 'teams.subteams'({ teamId }) {
    const identity = await requireIdentity(this);
    if (!isValidId(teamId)) throw new Meteor.Error('not-found', 'Invalid team id');
    const parent = await Teams.findOneAsync(new Mongo.ObjectID(teamId));
    if (!parent) throw new Meteor.Error('not-found', 'Team not found');
    if (!parent.members.includes(identity.userId)) {
      throw new Meteor.Error('forbidden', 'Not a team member');
    }
    const subs = await Teams.find(
      { parentTeamId: teamId, orgId: parent.orgId },
      { sort: { name: 1 } },
    ).fetchAsync();
    return { teams: subs.map(toPublicTeam) };
  },

  async 'teams.rename'({ teamId, newName }) {
    const identity = await requireIdentity(this);
    if (!isValidId(teamId)) throw new Meteor.Error('not-found', 'Invalid team id');
    if (typeof newName !== 'string' || !newName.trim()) {
      throw new Meteor.Error('bad-request', 'newName is required');
    }
    const team = await Teams.findOneAsync(new Mongo.ObjectID(teamId));
    if (!team) throw new Meteor.Error('not-found', 'Team not found');
    if (!team.admins.includes(identity.userId)) {
      throw new Meteor.Error('forbidden', 'Admin access required');
    }
    await Teams.updateAsync(team._id, { $set: { name: newName.trim(), updatedAt: new Date() } });
    const updated = await Teams.findOneAsync(team._id);
    return { team: toPublicTeam(updated) };
  },

  async 'teams.delete'({ teamId }) {
    const identity = await requireIdentity(this);
    if (!isValidId(teamId)) throw new Meteor.Error('not-found', 'Invalid team id');
    const team = await Teams.findOneAsync(new Mongo.ObjectID(teamId));
    if (!team) throw new Meteor.Error('not-found', 'Team not found');
    if (!team.admins.includes(identity.userId)) {
      throw new Meteor.Error('forbidden', 'Admin access required');
    }
    await Teams.removeAsync(team._id);
    return { ok: true };
  },

  async 'teams.getMembers'({ teamId }) {
    const identity = await requireIdentity(this);
    if (!isValidId(teamId)) throw new Meteor.Error('not-found', 'Invalid team id');
    const team = await Teams.findOneAsync(new Mongo.ObjectID(teamId));
    if (!team) throw new Meteor.Error('not-found', 'Team not found');
    if (!team.members.includes(identity.userId)) {
      throw new Meteor.Error('forbidden', 'Not a team member');
    }

    const allIds = Array.from(new Set([...team.members, ...team.admins]));
    const objectIds = allIds.filter(isValidId).map((id) => new ObjectId(id));
    const users = await rawDb().collection('user').find({ _id: { $in: objectIds } }).toArray();
    const byId = new Map(users.map((u) => [u._id.toHexString(), u]));

    return {
      members: allIds.map((id) => {
        const u = byId.get(id);
        return {
          id,
          name: u?.name ?? id,
          email: u?.email ?? '',
          username: u?.username ?? null,
          image: u?.image ?? null,
        };
      }),
    };
  },

  async 'teams.invite'({ teamId, email }) {
    const identity = await requireIdentity(this);
    if (!isValidId(teamId)) throw new Meteor.Error('not-found', 'Invalid team id');
    if (typeof email !== 'string' || !email.trim()) {
      throw new Meteor.Error('bad-request', 'email is required');
    }

    const team = await Teams.findOneAsync(new Mongo.ObjectID(teamId));
    if (!team) throw new Meteor.Error('not-found', 'Team not found');
    if (!team.members.includes(identity.userId)) {
      throw new Meteor.Error('forbidden', 'Not a team member');
    }

    const invitedUser = await rawDb().collection('user').findOne({ email: email.trim() });
    if (!invitedUser) throw new Meteor.Error('user-not-found', 'User not found');
    const invitedId = invitedUser._id.toHexString();
    if (team.members.includes(invitedId)) {
      throw new Meteor.Error('already-member', 'Already a member');
    }

    await Teams.updateAsync(team._id, {
      $addToSet: { members: invitedId },
      $set: { updatedAt: new Date() },
    });

    const db = rawDb();
    const org = team.orgId && isValidId(team.orgId)
      ? await db.collection('organizations').findOne({ _id: new ObjectId(team.orgId) })
      : null;
    if (org?.allowAutoJoin !== false) {
      await addOrgMember(team.orgId, invitedId, 'member', true);
    }

    return { ok: true };
  },

  async 'teams.removeMember'({ teamId, userId }) {
    const identity = await requireIdentity(this);
    if (!isValidId(teamId)) throw new Meteor.Error('not-found', 'Invalid team id');
    const team = await Teams.findOneAsync(new Mongo.ObjectID(teamId));
    if (!team) throw new Meteor.Error('not-found', 'Team not found');
    if (!team.admins.includes(identity.userId)) {
      throw new Meteor.Error('forbidden', 'Admin access required');
    }
    if (userId === identity.userId) {
      throw new Meteor.Error('cannot-remove-self', 'Cannot remove yourself');
    }
    if (!team.members.includes(userId)) {
      throw new Meteor.Error('not-member', 'Not a team member');
    }
    if (team.admins.includes(userId) && team.admins.filter((id) => id !== userId).length === 0) {
      throw new Meteor.Error('last-admin', 'Cannot remove the last admin');
    }

    await Teams.rawCollection().updateOne(
      { _id: team._id },
      { $pull: { members: userId, admins: userId }, $set: { updatedAt: new Date() } },
    );
    return { ok: true };
  },

  async 'teams.setRole'({ teamId, userId, role }) {
    const identity = await requireIdentity(this);
    if (!isValidId(teamId)) throw new Meteor.Error('not-found', 'Invalid team id');
    if (role !== 'admin' && role !== 'member') {
      throw new Meteor.Error('bad-request', 'role must be admin or member');
    }
    const team = await Teams.findOneAsync(new Mongo.ObjectID(teamId));
    if (!team) throw new Meteor.Error('not-found', 'Team not found');
    if (!team.admins.includes(identity.userId)) {
      throw new Meteor.Error('forbidden', 'Admin access required');
    }
    if (!team.members.includes(userId)) {
      throw new Meteor.Error('not-member', 'Not a team member');
    }

    if (role === 'admin') {
      await Teams.updateAsync(team._id, {
        $addToSet: { admins: userId },
        $set: { updatedAt: new Date() },
      });
    } else {
      const remaining = team.admins.filter((id) => id !== userId);
      if (remaining.length === 0) throw new Meteor.Error('last-admin', 'Cannot demote the last admin');
      await Teams.updateAsync(team._id, {
        $set: { admins: remaining, updatedAt: new Date() },
      });
    }
    return { ok: true };
  },

  async 'teams.setMemberPassword'({ teamId, userId, newPassword }) {
    const identity = await requireIdentity(this);
    if (!isValidId(teamId)) throw new Meteor.Error('not-found', 'Invalid team id');
    if (typeof newPassword !== 'string' || !newPassword) {
      throw new Meteor.Error('bad-request', 'newPassword is required');
    }
    const team = await Teams.findOneAsync(new Mongo.ObjectID(teamId));
    if (!team) throw new Meteor.Error('not-found', 'Team not found');
    if (!team.admins.includes(identity.userId)) {
      throw new Meteor.Error('forbidden', 'Admin access required');
    }
    if (!team.members.includes(userId)) {
      throw new Meteor.Error('not-member', 'Not a team member');
    }

    const bcrypt = await import('bcryptjs');
    const hashed = await bcrypt.hash(newPassword, 10);
    const result = await rawDb().collection('account').updateOne(
      { userId, providerId: 'credential' },
      { $set: { password: hashed } },
    );
    if (result.matchedCount === 0) throw new Meteor.Error('not-found', 'No credential account found');
    return { ok: true };
  },
});
