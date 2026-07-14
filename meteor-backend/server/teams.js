import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { MongoInternals } from 'meteor/mongo';
import { createHash, randomBytes } from 'crypto';
import { Teams, TeamJoinRequests, rawDb, isValidId } from './collections';
import { requireIdentity, identityForConnection } from './auth-bridge';
import { ensureDefaultOrganization, addOrgMember, getAccessibleOrgIds } from './org-helpers';
import { ensureDefaultChannel } from './channels';
import { createNotification } from './notify-core';
import { sendEmail } from './email';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;
const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

Meteor.startup(async () => {
  try {
    await rawDb().collection('team_invitations').createIndex(
      { teamId: 1, email: 1 },
      {
        name: 'unique_pending_team_invitation',
        unique: true,
        partialFilterExpression: { status: 'pending' },
      },
    );
  } catch (error) {
    console.error('[teams] failed to create invitation index:', error);
  }
});

// Safe ObjectId conversion — only converts 24-char hex strings
function toId(id) {
  return /^[a-f0-9]{24}$/i.test(id) ? new ObjectId(id) : id;
}

function generateTeamCode() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

function normalizeEmail(email) {
  if (typeof email !== 'string') return null;
  const normalized = email.trim().toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function hashInvitationToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function getInvitationByToken(token) {
  if (typeof token !== 'string' || token.length < 32) {
    throw new Meteor.Error('invalid-invitation', 'This invitation link is invalid.');
  }
  const invitations = rawDb().collection('team_invitations');
  const invitation = await invitations.findOne({ tokenHash: hashInvitationToken(token) });
  if (!invitation) {
    throw new Meteor.Error('invalid-invitation', 'This invitation link is invalid or has been revoked.');
  }
  if (invitation.status === 'accepted') {
    throw new Meteor.Error('invitation-used', 'This invitation has already been accepted.');
  }
  if (invitation.status === 'revoked') {
    throw new Meteor.Error('invitation-revoked', 'This invitation has been revoked.');
  }
  if (invitation.status !== 'pending') {
    throw new Meteor.Error('invalid-invitation', 'This invitation is no longer available.');
  }
  if (invitation.expiresAt <= new Date()) {
    await invitations.updateOne(
      { _id: invitation._id, status: 'pending' },
      { $set: { status: 'expired', updatedAt: new Date() } },
    );
    throw new Meteor.Error('invitation-expired', 'This invitation has expired. Ask a team administrator for a new one.');
  }
  return invitation;
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

    // Notify admins
    const requester = await rawDb().collection('users').findOne({ _id: String(identity.userId) });
    const requesterName = requester?.profile?.name ?? 'Someone';

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

    // All users are now in Meteor users collection
    const meteorUsers = await rawDb().collection('users').find({ _id: { $in: allIds } }).toArray();

    const byId = new Map();

    // Map Meteor users (profile.name, emails[].address)
    for (const u of meteorUsers) {
      byId.set(String(u._id), {
        name: u.profile?.name ?? null,
        email: u.emails?.[0]?.address ?? '',
        username: u.username ?? null,
        image: u.image ?? null,
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
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) throw new Meteor.Error('invalid-email', 'Enter a valid email address.');

    const team = await Teams.findOneAsync(new Mongo.ObjectID(teamId));
    if (!team) throw new Meteor.Error('not-found', 'Team not found');
    if (!team.admins.includes(userId)) {
      throw new Meteor.Error('forbidden', 'Admin access required');
    }

    const meteorUser = await rawDb().collection('users').findOne({ 'emails.address': normalizedEmail });

    if (meteorUser) {
      const invitedId = String(meteorUser._id);
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

      return { ok: true, status: 'joined' };
    }

    const db = rawDb();
    const invitations = db.collection('team_invitations');
    await invitations.updateMany(
      {
        teamId,
        email: normalizedEmail,
        status: 'pending',
        expiresAt: { $lte: new Date() },
      },
      { $set: { status: 'expired', updatedAt: new Date() } },
    );
    const duplicate = await invitations.findOne({
      teamId,
      email: normalizedEmail,
      status: 'pending',
    });
    if (duplicate) {
      throw new Meteor.Error(
        'invitation-exists',
        'A pending invitation already exists for this email address.',
      );
    }

    const token = randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITATION_LIFETIME_MS);
    const invitation = {
      _id: new ObjectId(),
      teamId,
      email: normalizedEmail,
      tokenHash: hashInvitationToken(token),
      invitedBy: userId,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      expiresAt,
    };
    try {
      await invitations.insertOne(invitation);
    } catch (error) {
      if (error?.code === 11000) {
        throw new Meteor.Error(
          'invitation-exists',
          'A pending invitation already exists for this email address.',
        );
      }
      throw error;
    }

    const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
    const invitationUrl = `${appUrl}/app?mode=signup&invite=${encodeURIComponent(token)}`;
    try {
      await sendEmail({
        to: normalizedEmail,
        subject: "You're invited to join a team on TimeHuddle",
        html: `<p>You have been invited to join <strong>${escapeHtml(team.name)}</strong> on TimeHuddle.</p>
<p><a href="${escapeHtml(invitationUrl)}">Create your account and join the team</a></p>
<p>This invitation expires in 7 days. If you did not expect this invitation, you can ignore this email.</p>`,
      });
    } catch (error) {
      await invitations.updateOne(
        { _id: invitation._id },
        { $set: { status: 'delivery_failed', updatedAt: new Date() } },
      );
      console.error('[teams.invite] invitation email failed:', error);
      throw new Meteor.Error(
        'delivery-failed',
        'The invitation could not be delivered. Check the address and try again.',
      );
    }

    return {
      ok: true,
      status: 'pending',
      invitationId: invitation._id.toHexString(),
      expiresAt: expiresAt.toISOString(),
    };
  },

  async 'teams.getInvitation'({ token }) {
    const invitation = await getInvitationByToken(token);
    const team = await Teams.findOneAsync(new Mongo.ObjectID(invitation.teamId));
    if (!team) throw new Meteor.Error('not-found', 'The invited team no longer exists.');
    return {
      teamName: team.name,
      email: invitation.email,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  },

  async 'teams.acceptInvite'({ token }) {
    const identity = await requireIdentity(this);
    const invitation = await getInvitationByToken(token);
    const user = await rawDb().collection('users').findOne({ _id: String(identity.userId) });
    const userEmail = normalizeEmail(user?.emails?.[0]?.address);
    if (userEmail !== invitation.email) {
      throw new Meteor.Error(
        'email-mismatch',
        `Sign in with ${invitation.email} to accept this invitation.`,
      );
    }

    const invitations = rawDb().collection('team_invitations');
    const acceptedAt = new Date();
    const claimed = await invitations.findOneAndUpdate(
      { _id: invitation._id, status: 'pending', expiresAt: { $gt: acceptedAt } },
      {
        $set: {
          status: 'accepted',
          acceptedAt,
          acceptedBy: identity.userId,
          updatedAt: acceptedAt,
        },
      },
      { returnDocument: 'after' },
    );
    if (!claimed) return getInvitationByToken(token);

    const team = await Teams.findOneAsync(new Mongo.ObjectID(invitation.teamId));
    if (!team) {
      await invitations.updateOne(
        { _id: invitation._id, acceptedBy: identity.userId },
        { $set: { status: 'revoked', updatedAt: new Date() } },
      );
      throw new Meteor.Error('not-found', 'The invited team no longer exists.');
    }

    await Teams.updateAsync(team._id, {
      $addToSet: { members: identity.userId },
      $set: { updatedAt: new Date() },
    });
    const org = team.orgId && isValidId(team.orgId)
      ? await rawDb().collection('organizations').findOne({ _id: new ObjectId(team.orgId) })
      : null;
    if (org?.allowAutoJoin !== false) {
      await addOrgMember(team.orgId, identity.userId, 'member', true);
    }

    return { ok: true, team: toPublicTeam({ ...team, members: [...new Set([...team.members, identity.userId])] }) };
  },

  async 'teams.revokeInvite'({ invitationId }) {
    const identity = await requireIdentity(this);
    if (typeof invitationId !== 'string' || !/^[a-f0-9]{24}$/i.test(invitationId)) {
      throw new Meteor.Error('not-found', 'Invalid invitation id');
    }
    const invitations = rawDb().collection('team_invitations');
    const invitation = await invitations.findOne({ _id: new ObjectId(invitationId) });
    if (!invitation) throw new Meteor.Error('not-found', 'Invitation not found');
    const team = await Teams.findOneAsync(new Mongo.ObjectID(invitation.teamId));
    if (!team || !team.admins.includes(identity.userId)) {
      throw new Meteor.Error('forbidden', 'Admin access required');
    }
    if (invitation.status !== 'pending') {
      throw new Meteor.Error('invalid-invitation', 'Only pending invitations can be revoked.');
    }
    await invitations.updateOne(
      { _id: invitation._id, status: 'pending' },
      { $set: { status: 'revoked', revokedAt: new Date(), updatedAt: new Date() } },
    );
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

    // Use Meteor Accounts to set password (replaces Better Auth account collection)
    await Accounts.setPasswordAsync(targetUserId, newPassword, { logout: false });
    return { ok: true };
  },
});
