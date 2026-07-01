import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { MongoInternals } from 'meteor/mongo';
import { Teams, TeamJoinRequests, rawDb, isValidId } from './collections';
import { requireIdentity, identityForConnection } from './auth-bridge';
import { ensureDefaultOrganization, addOrgMember, getAccessibleOrgIds } from './org-helpers';
import { ensureDefaultChannel } from './channels';
import { createNotification } from './notify-core';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

// Safe ObjectId conversion — only converts 24-char hex strings
function toId(id) {
  return /^[a-f0-9]{24}$/i.test(id) ? new ObjectId(id) : id;
}

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
  if (!this.userId) return this.ready();
  const userId = this.userId;
  return Teams.find({ members: userId });
});

Meteor.methods({
  async 'teams.list'() {
    const identity = await requireIdentity(this);
    const teams = await Teams.find({ members: identity.userId }).fetchAsync();

    const userPending = await TeamJoinRequests.rawCollection()
      .find({ userId: identity.userId, status: 'pending' })
      .sort({ requestedAt: -1 })
      .toArray();

    const adminTeamIds = teams.filter((t) => t.admins?.includes(identity.userId)).map((t) => {
      const id = t._id?.toHexString ? t._id.toHexString() : String(t._id);
      return id;
    });

    let adminPending = [];
    if (adminTeamIds.length > 0) {
      adminPending = await TeamJoinRequests.rawCollection()
        .find({ teamId: { $in: adminTeamIds }, status: 'pending' })
        .sort({ requestedAt: -1 })
        .toArray();
    }

    const seen = new Set();
    const allPending = [...userPending, ...adminPending].filter((r) => {
      const id = r._id?.toHexString ? r._id.toHexString() : String(r._id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    const toPublic = (r) => ({
      id: r._id?.toHexString ? r._id.toHexString() : String(r._id),
      teamId: r.teamId,
      userId: r.userId,
      teamCode: r.teamCode,
      status: r.status,
      requestedAt: r.requestedAt instanceof Date ? r.requestedAt.toISOString() : String(r.requestedAt),
      respondedAt: r.respondedAt instanceof Date ? r.respondedAt.toISOString() : undefined,
      respondedBy: r.respondedBy,
    });

    return {
      teams: teams.map(toPublicTeam).sort((a, b) => {
        if (a.isPersonal !== b.isPersonal) return a.isPersonal ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
      pendingRequests: allPending.map(toPublic),
    };
  },

  async 'teams.ensurePersonal'() {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    const existing = await Teams.findOneAsync({ isPersonal: true, members: userId });
    if (existing) return { team: toPublicTeam(existing) };

    const defaultOrg = await ensureDefaultOrganization();
    const doc = {
      _id: new Mongo.ObjectID(),
      orgId: defaultOrg._id.toHexString(),
      parentTeamId: null,
      name: 'Personal',
      members: [userId],
      admins: [userId],
      code: generateTeamCode(),
      isPersonal: true,
      createdAt: new Date(),
    };
    await Teams.insertAsync(doc);
    ensureDefaultChannel(doc._id.toHexString(), userId).catch(() => {});
    return { team: toPublicTeam(doc) };
  },

  async 'teams.create'({ name, description, orgId: requestedOrgId, parentTeamId }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (typeof name !== 'string' || !name.trim()) {
      throw new Meteor.Error('bad-request', 'name is required');
    }

    const accessibleOrgIds = await getAccessibleOrgIds(userId);
    let orgId = requestedOrgId ?? accessibleOrgIds[0] ?? null;

    if (!orgId) {
      const defaultOrg = await ensureDefaultOrganization();
      await addOrgMember(defaultOrg._id.toHexString(), userId, 'member', true);
      orgId = defaultOrg._id.toHexString();
    }

    if (requestedOrgId && !accessibleOrgIds.includes(requestedOrgId)) {
      const defaultOrg = await ensureDefaultOrganization();
      await addOrgMember(defaultOrg._id.toHexString(), userId, 'member', true);
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
      members: [userId],
      admins: [userId],
      code: generateTeamCode(),
      isPersonal: false,
      createdAt: new Date(),
    };
    await Teams.insertAsync(doc);
    await addOrgMember(orgId, userId, 'member', true);
    ensureDefaultChannel(doc._id.toHexString(), userId).catch(() => {});
    return { team: toPublicTeam(doc) };
  },

  async 'teams.join'({ teamCode }) {
    const identity = await requireIdentity(this);
    if (typeof teamCode !== 'string' || !teamCode.trim()) {
      throw new Meteor.Error('bad-request', 'teamCode is required');
    }

    const team = await Teams.rawCollection().findOne({ code: teamCode.toUpperCase() });
    if (!team) throw new Meteor.Error('not-found', 'Team not found');
    const teamId = team._id.toHexString ? team._id.toHexString() : String(team._id);

    if (team.members.includes(identity.userId)) {
      throw new Meteor.Error('already-member', 'Already a member');
    }

    // Check if user is an organization owner - owners can join any team directly
    if (team.orgId && isValidId(team.orgId)) {
      const membership = await rawDb().collection('org_members').findOne({
        orgId: team.orgId,
        userId: identity.userId,
      });
      if (membership && membership.role === 'owner') {
        // Add owner directly to team without approval
        await Teams.updateAsync(new Mongo.ObjectID(team._id), {
          $addToSet: { members: identity.userId },
          $set: { updatedAt: new Date() },
        });

        const updatedTeam = await Teams.findOneAsync(new Mongo.ObjectID(team._id));
        return { status: 'joined', team: toPublicTeam(updatedTeam) };
      }
    }

    const existing = await TeamJoinRequests.rawCollection().findOne({
      teamId,
      userId: identity.userId,
      status: 'pending',
    });
    if (existing) {
      return {
        status: 'pending',
        request: {
          id: existing._id.toHexString ? existing._id.toHexString() : String(existing._id),
          teamId: existing.teamId,
          userId: existing.userId,
          teamCode: existing.teamCode,
          status: existing.status,
          requestedAt: existing.requestedAt instanceof Date ? existing.requestedAt.toISOString() : String(existing.requestedAt),
        },
      };
    }

    const doc = {
      _id: new ObjectId(),
      teamId,
      userId: identity.userId,
      teamCode: teamCode.toUpperCase(),
      status: 'pending',
      requestedAt: new Date(),
      createdAt: new Date(),
    };
    await TeamJoinRequests.rawCollection().insertOne(doc);

    const requestId = doc._id.toHexString();

    // Notify admins — use toId() to support both Meteor and Fastify user IDs
    const requester = await rawDb().collection('user').findOne({ _id: toId(identity.userId) })
      ?? await rawDb().collection('users').findOne({ _id: identity.userId });
    const requesterName = requester?.name ?? requester?.profile?.name ?? 'Someone';

    for (const adminId of (team.admins || [])) {
      createNotification({
        userId: adminId,
        title: 'New team join request',
        body: `${requesterName} wants to join ${team.name}`,
        data: {
          type: 'team-join-request',
          teamId,
          requesterId: identity.userId,
          requestId,
          url: `/app/teams?tab=pending&teamId=${teamId}`,
        },
      }).catch((err) => console.error('[teams] notify admin failed:', err));
    }

    return {
      status: 'pending',
      request: {
        id: requestId,
        teamId,
        userId: identity.userId,
        teamCode: teamCode.toUpperCase(),
        status: 'pending',
        requestedAt: doc.requestedAt.toISOString(),
      },
    };
  },

  async 'teams.subteams'({ teamId }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(teamId)) throw new Meteor.Error('not-found', 'Invalid team id');
    const parent = await Teams.findOneAsync(new Mongo.ObjectID(teamId));
    if (!parent) throw new Meteor.Error('not-found', 'Team not found');
    if (!parent.members.includes(userId)) {
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
    const userId = identity.userId;
    if (!isValidId(teamId)) throw new Meteor.Error('not-found', 'Invalid team id');
    if (typeof newName !== 'string' || !newName.trim()) {
      throw new Meteor.Error('bad-request', 'newName is required');
    }
    const team = await Teams.findOneAsync(new Mongo.ObjectID(teamId));
    if (!team) throw new Meteor.Error('not-found', 'Team not found');
    if (!team.admins.includes(userId)) {
      throw new Meteor.Error('forbidden', 'Admin access required');
    }
    await Teams.updateAsync(team._id, { $set: { name: newName.trim(), updatedAt: new Date() } });
    const updated = await Teams.findOneAsync(team._id);
    return { team: toPublicTeam(updated) };
  },

  async 'teams.delete'({ teamId }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(teamId)) throw new Meteor.Error('not-found', 'Invalid team id');
    const team = await Teams.findOneAsync(new Mongo.ObjectID(teamId));
    if (!team) throw new Meteor.Error('not-found', 'Team not found');
    if (!team.admins.includes(userId)) {
      throw new Meteor.Error('forbidden', 'Admin access required');
    }
    await Teams.removeAsync(team._id);
    return { ok: true };
  },

  async 'teams.getMembers'({ teamId }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(teamId)) throw new Meteor.Error('not-found', 'Invalid team id');
    const team = await Teams.findOneAsync(new Mongo.ObjectID(teamId));
    if (!team) throw new Meteor.Error('not-found', 'Team not found');
    if (!team.members.includes(userId)) {
      throw new Meteor.Error('forbidden', 'Not a team member');
    }

    const allIds = Array.from(new Set([...team.members, ...team.admins]));
    
    // Fetch from both collections
    const fastifyIds = allIds.filter(id => /^[0-9a-f]{24}$/i.test(id)).map(id => new ObjectId(id));
    const fastifyUsers = fastifyIds.length
      ? await rawDb().collection('user').find({ _id: { $in: fastifyIds } }).toArray()
      : [];
    const meteorUsers = await rawDb().collection('users').find({ _id: { $in: allIds } }).toArray();

    const byId = new Map();
    for (const u of fastifyUsers) byId.set(u._id.toHexString(), { 
      name: u.name, email: u.email, username: u.username, image: u.image 
    });
    for (const u of meteorUsers) {
      const id = String(u._id);
      if (!byId.has(id)) byId.set(id, {
        name: u.profile?.name ?? null,
        email: u.emails?.[0]?.address ?? '',
        username: u.username ?? null,
        image: u.image ?? null,
      });
    }

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
    const userId = identity.userId;
    if (!isValidId(teamId)) throw new Meteor.Error('not-found', 'Invalid team id');
    if (typeof email !== 'string' || !email.trim()) {
      throw new Meteor.Error('bad-request', 'email is required');
    }

    const team = await Teams.findOneAsync(new Mongo.ObjectID(teamId));
    if (!team) throw new Meteor.Error('not-found', 'Team not found');
    if (!team.members.includes(userId)) {
      throw new Meteor.Error('forbidden', 'Not a team member');
    }

    // Check both Better Auth and Meteor user collections
    const normalizedEmail = email.trim();
    const [baUser, meteorUser] = await Promise.all([
      rawDb().collection('user').findOne({ email: normalizedEmail }),
      rawDb().collection('users').findOne({ 'emails.address': normalizedEmail })
    ]);

    let invitedId;
    if (baUser) {
      // Better Auth 'user' collection can have ObjectId (native BA) or string (Meteor-synced)
      invitedId = typeof baUser._id === 'string' ? baUser._id : baUser._id.toHexString();
    } else if (meteorUser) {
      invitedId = meteorUser._id; // Meteor uses string IDs
    } else {
      throw new Meteor.Error('user-not-found', 'User not found');
    }

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

  async 'teams.removeMember'({ teamId, userId: targetUserId }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(teamId)) throw new Meteor.Error('not-found', 'Invalid team id');
    const team = await Teams.findOneAsync(new Mongo.ObjectID(teamId));
    if (!team) throw new Meteor.Error('not-found', 'Team not found');
    if (!team.admins.includes(userId)) {
      throw new Meteor.Error('forbidden', 'Admin access required');
    }
    if (targetUserId === userId) {
      throw new Meteor.Error('cannot-remove-self', 'Cannot remove yourself');
    }
    if (!team.members.includes(targetUserId)) {
      throw new Meteor.Error('not-member', 'Not a team member');
    }
    if (team.admins.includes(targetUserId) && team.admins.filter((id) => id !== targetUserId).length === 0) {
      throw new Meteor.Error('last-admin', 'Cannot remove the last admin');
    }

    // Use Meteor's updateAsync instead of rawCollection to ensure proper reactivity
    await Teams.updateAsync(team._id, {
      $pull: { members: targetUserId, admins: targetUserId },
      $set: { updatedAt: new Date() },
    });
    return { ok: true };
  },

  async 'teams.setRole'({ teamId, userId: targetUserId, role }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(teamId)) throw new Meteor.Error('not-found', 'Invalid team id');
    if (role !== 'admin' && role !== 'member') {
      throw new Meteor.Error('bad-request', 'role must be admin or member');
    }
    const team = await Teams.findOneAsync(new Mongo.ObjectID(teamId));
    if (!team) throw new Meteor.Error('not-found', 'Team not found');
    if (!team.admins.includes(userId)) {
      throw new Meteor.Error('forbidden', 'Admin access required');
    }
    if (!team.members.includes(targetUserId)) {
      throw new Meteor.Error('not-member', 'Not a team member');
    }

    if (role === 'admin') {
      await Teams.updateAsync(team._id, {
        $addToSet: { admins: targetUserId },
        $set: { updatedAt: new Date() },
      });
    } else {
      const remaining = team.admins.filter((id) => id !== targetUserId);
      if (remaining.length === 0) throw new Meteor.Error('last-admin', 'Cannot demote the last admin');
      await Teams.updateAsync(team._id, {
        $set: { admins: remaining, updatedAt: new Date() },
      });
    }
    return { ok: true };
  },

  async 'teams.setMemberPassword'({ teamId, userId: targetUserId, newPassword }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(teamId)) throw new Meteor.Error('not-found', 'Invalid team id');
    if (typeof newPassword !== 'string' || !newPassword) {
      throw new Meteor.Error('bad-request', 'newPassword is required');
    }
    const team = await Teams.findOneAsync(new Mongo.ObjectID(teamId));
    if (!team) throw new Meteor.Error('not-found', 'Team not found');
    if (!team.admins.includes(userId)) {
      throw new Meteor.Error('forbidden', 'Admin access required');
    }
    if (!team.members.includes(targetUserId)) {
      throw new Meteor.Error('not-member', 'Not a team member');
    }

    const bcrypt = await import('bcryptjs');
    const hashed = await bcrypt.hash(newPassword, 10);
    const result = await rawDb().collection('account').updateOne(
      { userId: targetUserId, providerId: 'credential' },
      { $set: { password: hashed } },
    );
    if (result.matchedCount === 0) throw new Meteor.Error('not-found', 'No credential account found');
    return { ok: true };
  },
});
