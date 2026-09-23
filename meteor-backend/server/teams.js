import { randomBytes } from 'crypto';

import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { MongoInternals } from 'meteor/mongo';
import { Teams, TeamJoinRequests, rawDb, isValidId } from './collections';
import { requireIdentity, identityForConnection, findUserById } from './auth-bridge';
import {
  ensureDefaultOrganization,
  addOrgMember,
  getAccessibleOrgIds,
  isTeamAdminOrOrgOwner,
} from './org-helpers';
import { createNotification } from './notify-core';
import { sendEmail } from './email';
import {
  INVITATION_LIFETIME_MS,
  APP_URL,
  normalizeEmail,
  generateInvitationToken,
  hashInvitationToken,
  escapeHtml,
} from './invitation-helpers';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

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

  // A team code identifies a team, so two teams sharing one would send a
  // joiner to whichever document Mongo returned first.
  try {
    await rawDb()
      .collection('teams')
      .createIndex(
        { code: 1 },
        {
          name: 'unique_team_code',
          unique: true,
          // Scoped to documents that have a code: a legacy team without one
          // would otherwise collide with the next such team and cost every
          // other team the index.
          partialFilterExpression: { code: { $type: 'string' } },
        },
      );
  } catch (error) {
    console.error('[teams] failed to create team code index:', error);
  }
});

// Safe ObjectId conversion — only converts 24-char hex strings
function toId(id) {
  return /^[a-f0-9]{24}$/i.test(id) ? new ObjectId(id) : id;
}

// Crockford base32: 32 symbols, so a byte maps onto one with no modulo bias,
// and the pairs people misread off a screen (0/O, 1/I/L) can't both occur.
const TEAM_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A team code names a team — it is not a credential. Joining with one always
 * goes through the team's approval settings ('teams.join'); only an
 * admin-minted invite link grants membership outright. It is still generated
 * with a CSPRNG: a team that auto-accepts join requests would otherwise admit
 * anyone who could guess or predict a code.
 */
function generateTeamCode() {
  let code = '';
  for (const byte of randomBytes(8)) code += TEAM_CODE_ALPHABET[byte % 32];
  return code;
}

/**
 * Invite-link tokens are 32 random bytes as 64 hex characters (see
 * generateInvitationToken); team codes are 8 base32 characters. The shapes
 * never collide, so a single `?join=` value can carry either one.
 */
function isInviteLinkToken(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value.trim());
}

function inviteLinkUrl(token) {
  return `${APP_URL}/app?mode=signup&join=${encodeURIComponent(token)}`;
}

/** The single "Personal" team every user gets, created on first need. */
export async function ensurePersonalTeam(userId) {
  const existing = await Teams.findOneAsync({ isPersonal: true, members: userId });
  if (existing) return existing;

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
  await addOrgMember(defaultOrg._id.toHexString(), userId, 'member', true);
  return doc;
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

/**
 * An invite link runs the same validation ladder as an email invitation —
 * unknown, revoked and expired tokens are all rejected there — narrowed to
 * link invitations, so an email invitation's token cannot be redeemed as a
 * link and skip the address check that binds it to one recipient.
 */
async function getInviteLinkByToken(token) {
  const invitation = await getInvitationByToken(token);
  if (invitation.kind !== 'link') {
    throw new Meteor.Error('invalid-invitation', 'This invite link is invalid.');
  }
  return invitation;
}

/** Loads a team and asserts the caller may administer it. */
async function requireTeamAdmin(teamId, userId) {
  if (!isValidId(teamId)) throw new Meteor.Error('not-found', 'Invalid team id');
  const team = await Teams.findOneAsync(new Mongo.ObjectID(teamId));
  if (!team) throw new Meteor.Error('not-found', 'Team not found');
  if (!(await isTeamAdminOrOrgOwner(team, userId))) {
    throw new Meteor.Error('forbidden', 'Admin access required');
  }
  return team;
}

function toPublicInvitation(doc, invitedByName) {
  const id = doc._id?.toHexString ? doc._id.toHexString() : String(doc._id);
  return {
    id,
    email: doc.email,
    status: doc.status,
    invitedByName: invitedByName ?? 'Unknown',
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : String(doc.createdAt),
    expiresAt: doc.expiresAt instanceof Date ? doc.expiresAt.toISOString() : String(doc.expiresAt),
    acceptedAt: doc.acceptedAt instanceof Date ? doc.acceptedAt.toISOString() : undefined,
    revokedAt: doc.revokedAt instanceof Date ? doc.revokedAt.toISOString() : undefined,
  };
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
    settings: {
      requirePlanForClock: team.settings?.requirePlanForClock ?? false,
      autoAcceptJoins: team.settings?.autoAcceptJoins ?? false,
    },
    createdAt: team.createdAt instanceof Date ? team.createdAt.toISOString() : String(team.createdAt),
    updatedAt: team.updatedAt instanceof Date ? team.updatedAt.toISOString() : (team.updatedAt ?? null),
  };
}

/**
 * Redeem an admin-minted invite link.
 *
 * A link is meant for inviting a group, so redeeming it never consumes it: it
 * stays live until it expires or is revoked, and opening it again as a member
 * is a no-op rather than a second membership.
 *
 * What it grants is the team's decision, not the link's. A team that accepts
 * join requests without review admits the holder outright; a team that reviews
 * its joiners reviews these too — holding a link is not a way around a setting
 * whose whole purpose is to see who is coming in.
 */
async function redeemInviteLink(identity, token) {
  const invitation = await getInviteLinkByToken(token);
  const team = await Teams.findOneAsync(new Mongo.ObjectID(invitation.teamId));
  if (!team) throw new Meteor.Error('not-found', 'The invited team no longer exists.');

  if (team.members.includes(identity.userId)) {
    return { status: 'joined', team: toPublicTeam(team) };
  }

  if (!team.settings?.autoAcceptJoins) {
    const result = await requestToJoin(identity, team, invitation.teamId);
    // Only a new arrival counts as a use; reopening the link while already
    // waiting does not.
    if (result.created) await countInviteLinkUse(invitation._id);
    return result;
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

  // Clear any stale pending request for this user/team now that they're a
  // full member — otherwise it lingers in the admin approval queue.
  await TeamJoinRequests.rawCollection().deleteMany({
    teamId: invitation.teamId,
    userId: identity.userId,
    status: 'pending',
  });

  await countInviteLinkUse(invitation._id);

  const updated = await Teams.findOneAsync(team._id);
  return { status: 'joined', team: toPublicTeam(updated) };
}

/** Record that someone came through an invite link, for the admin's count. */
async function countInviteLinkUse(invitationId) {
  const usedAt = new Date();
  await rawDb()
    .collection('team_invitations')
    .updateOne(
      { _id: invitationId },
      { $inc: { useCount: 1 }, $set: { lastUsedAt: usedAt, updatedAt: usedAt } },
    );
}

/**
 * Join a team by its code. The code is an identifier, not a credential, so
 * this always lands in the team's approval flow — a pending request, or an
 * immediate join only where the team or its org has opted into one. Shared
 * by 'teams.join' and by the legacy `?join=<CODE>` links that
 * 'teams.joinByLink' still accepts.
 */
async function joinTeamByCode(identity, teamCode, { idempotent = false } = {}) {
  if (typeof teamCode !== 'string' || !teamCode.trim()) {
    throw new Meteor.Error('bad-request', 'teamCode is required');
  }

  const team = await Teams.rawCollection().findOne({ code: teamCode.toUpperCase() });
  if (!team) throw new Meteor.Error('not-found', 'Team not found');
  const teamId = team._id.toHexString ? team._id.toHexString() : String(team._id);

  if (team.members.includes(identity.userId)) {
    // Typing a code you already used is a mistake worth reporting; reopening a
    // link you already accepted is not.
    if (!idempotent) throw new Meteor.Error('already-member', 'Already a member');
    return { status: 'joined', team: toPublicTeam(team) };
  }

  // Check if user is an organization owner - owners can join any team directly
  if (team.orgId && isValidId(team.orgId)) {
    const membership = await rawDb().collection('org_members').findOne({
      orgId: team.orgId,
      userId: identity.userId,
    });
    if (membership && membership.role === 'owner') {
      // Add owner directly to team without approval
      await Teams.updateAsync(new Mongo.ObjectID(teamId), {
        $addToSet: { members: identity.userId },
        $set: { updatedAt: new Date() },
      });

      const updatedTeam = await Teams.findOneAsync(new Mongo.ObjectID(teamId));
      return { status: 'joined', team: toPublicTeam(updatedTeam) };
    }
  }

  // Team setting: auto-accept join requests — add the member immediately
  // instead of creating a pending request awaiting admin approval.
  if (team.settings?.autoAcceptJoins) {
    await Teams.updateAsync(new Mongo.ObjectID(teamId), {
      $addToSet: { members: identity.userId },
      $set: { updatedAt: new Date() },
    });
    if (team.orgId && isValidId(team.orgId)) {
      const org = await rawDb().collection('organizations').findOne({ _id: new ObjectId(team.orgId) });
      if (org?.allowAutoJoin !== false) {
        await addOrgMember(team.orgId, identity.userId, 'member', true);
      }
    }
    // Clear any stale pending request for this user/team now that they're a
    // full member — otherwise it lingers in the admin approval queue.
    await TeamJoinRequests.rawCollection().deleteMany({
      teamId,
      userId: identity.userId,
      status: 'pending',
    });
    const updatedTeam = await Teams.findOneAsync(new Mongo.ObjectID(teamId));
    return { status: 'joined', team: toPublicTeam(updatedTeam) };
  }

  return requestToJoin(identity, team, teamId);
}

/**
 * Put the user in the team's approval queue, or hand back the request they
 * already have waiting. Shared by every route that reaches a team which
 * reviews its joiners — typing the code, and opening an invite link.
 *
 * Returns `created: false` when a pending request was already there, so
 * callers can tell a fresh arrival from someone reopening the same link.
 */
async function requestToJoin(identity, team, teamId) {
  const existing = await TeamJoinRequests.rawCollection().findOne({
    teamId,
    userId: identity.userId,
    status: 'pending',
  });
  if (existing) {
    return {
      status: 'pending',
      created: false,
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
    teamCode: team.code,
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
    created: true,
    request: {
      id: requestId,
      teamId,
      userId: identity.userId,
      teamCode: team.code,
      status: 'pending',
      requestedAt: doc.requestedAt.toISOString(),
    },
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
    return { team: toPublicTeam(await ensurePersonalTeam(identity.userId)) };
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
    return { team: toPublicTeam(doc) };
  },

  async 'teams.join'({ teamCode }) {
    const identity = await requireIdentity(this);
    return joinTeamByCode(identity, teamCode);
  },

  /**
   * Public (unauthenticated) preview of what a `?join=` value opens, so the
   * login page can name the team before asking anyone to sign in or sign up.
   * Accepts an invite-link token or a team code, and exposes only what that
   * banner needs.
   */
  async 'teams.previewJoinLink'({ value }) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Meteor.Error('bad-request', 'value is required');
    }
    if (isInviteLinkToken(value)) {
      const invitation = await getInviteLinkByToken(value.trim());
      const team = await Teams.findOneAsync(new Mongo.ObjectID(invitation.teamId));
      if (!team) throw new Meteor.Error('not-found', 'The invited team no longer exists.');
      return {
        teamName: team.name,
        kind: 'link',
        requiresApproval: !team.settings?.autoAcceptJoins,
      };
    }
    const team = await Teams.rawCollection().findOne({ code: value.trim().toUpperCase() });
    if (!team || team.isPersonal) {
      throw new Meteor.Error('not-found', 'This team join link is invalid or no longer available.');
    }
    return {
      teamName: team.name,
      kind: 'code',
      requiresApproval: !team.settings?.autoAcceptJoins,
    };
  },

  /**
   * Redeem a `?join=` value. An invite-link token grants membership outright;
   * a bare team code never does — it goes through the team's approval settings
   * like any other code, which is what the QR codes and links shared before
   * invite links existed now degrade to.
   */
  async 'teams.joinByLink'({ value }) {
    const identity = await requireIdentity(this);
    if (typeof value !== 'string' || !value.trim()) {
      throw new Meteor.Error('bad-request', 'value is required');
    }
    if (isInviteLinkToken(value)) return redeemInviteLink(identity, value.trim());
    return joinTeamByCode(identity, value.trim(), { idempotent: true });
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
    if (!(await isTeamAdminOrOrgOwner(team, userId))) {
      throw new Meteor.Error('forbidden', 'Admin access required');
    }
    await Teams.updateAsync(team._id, { $set: { name: newName.trim(), updatedAt: new Date() } });
    const updated = await Teams.findOneAsync(team._id);
    return { team: toPublicTeam(updated) };
  },

  async 'teams.updateSettings'({ teamId, requirePlanForClock, autoAcceptJoins }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(teamId)) throw new Meteor.Error('not-found', 'Invalid team id');
    if (requirePlanForClock === undefined && autoAcceptJoins === undefined) {
      throw new Meteor.Error('bad-request', 'No settings provided');
    }
    if (requirePlanForClock !== undefined && typeof requirePlanForClock !== 'boolean') {
      throw new Meteor.Error('bad-request', 'requirePlanForClock must be a boolean');
    }
    if (autoAcceptJoins !== undefined && typeof autoAcceptJoins !== 'boolean') {
      throw new Meteor.Error('bad-request', 'autoAcceptJoins must be a boolean');
    }
    const team = await Teams.findOneAsync(new Mongo.ObjectID(teamId));
    if (!team) throw new Meteor.Error('not-found', 'Team not found');
    if (!(await isTeamAdminOrOrgOwner(team, userId))) {
      throw new Meteor.Error('forbidden', 'Admin access required');
    }
    const $set = { updatedAt: new Date() };
    if (requirePlanForClock !== undefined) $set['settings.requirePlanForClock'] = requirePlanForClock;
    if (autoAcceptJoins !== undefined) $set['settings.autoAcceptJoins'] = autoAcceptJoins;
    await Teams.updateAsync(team._id, { $set });
    const updated = await Teams.findOneAsync(team._id);

    // Notify all members (except the admin making the change) when plan-gate is enabled
    if (requirePlanForClock === true && !team.settings?.requirePlanForClock) {
      const memberIds = Array.from(new Set([...team.members, ...team.admins])).filter(
        (id) => id !== userId,
      );
      const teamLabel = team.name ?? 'Your team';
      await Promise.allSettled(
        memberIds.map((memberId) =>
          createNotification({
            userId: memberId,
            title: `${teamLabel} now requires a plan before clocking in`,
            body: 'Write a short plan on the Clock In/Out page before starting your next shift.',
            data: { type: 'team-setting-change', url: '/app/clock', teamId: String(team._id) },
          }),
        ),
      );
    }

    return { team: toPublicTeam(updated) };
  },

  async 'teams.delete'({ teamId }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(teamId)) throw new Meteor.Error('not-found', 'Invalid team id');
    const team = await Teams.findOneAsync(new Mongo.ObjectID(teamId));
    if (!team) throw new Meteor.Error('not-found', 'Team not found');
    if (!(await isTeamAdminOrOrgOwner(team, userId))) {
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
    if (!(await isTeamAdminOrOrgOwner(team, userId))) {
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

    const token = generateInvitationToken();
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

    const invitationUrl = `${APP_URL}/app?mode=signup&invite=${encodeURIComponent(token)}`;
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
    if (invitation.kind === 'link') {
      // Link tokens are redeemed through 'teams.joinByLink'; accepting one
      // here would bypass nothing, but it would mark a group link consumed.
      throw new Meteor.Error('invalid-invitation', 'This invitation is invalid.');
    }
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

  async 'teams.getPendingInvitations'({ teamId }) {
    const identity = await requireIdentity(this);
    if (!isValidId(teamId)) throw new Meteor.Error('not-found', 'Invalid team id');

    const team = await Teams.findOneAsync(new Mongo.ObjectID(teamId));
    if (!team) throw new Meteor.Error('not-found', 'Team not found');
    if (!(await isTeamAdminOrOrgOwner(team, identity.userId))) {
      throw new Meteor.Error('forbidden', 'Admin access required');
    }

    const invitations = await rawDb()
      .collection('team_invitations')
      .find({ teamId, kind: { $ne: 'link' } })
      .sort({ createdAt: -1 })
      .toArray();

    const invitedByIds = [...new Set(invitations.map((i) => i.invitedBy).filter(Boolean))];
    const userMap = new Map();
    await Promise.all(
      invitedByIds.map(async (id) => {
        const user = await findUserById(id);
        if (user) userMap.set(id, user);
      }),
    );

    return {
      invitations: invitations.map((i) => toPublicInvitation(i, userMap.get(i.invitedBy)?.name)),
    };
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
    if (!team || !(await isTeamAdminOrOrgOwner(team, identity.userId))) {
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

  /**
   * Mint a shareable invite link for a team, replacing any active one.
   *
   * Only the token's hash is stored, so this call is the one and only chance
   * to read the URL — which is also what makes generating a replacement the
   * same act as revoking what came before it.
   */
  async 'teams.createInviteLink'({ teamId }) {
    const identity = await requireIdentity(this);
    const team = await requireTeamAdmin(teamId, identity.userId);
    if (team.isPersonal) {
      throw new Meteor.Error('forbidden', 'A personal workspace cannot be shared.');
    }

    const invitations = rawDb().collection('team_invitations');
    const now = new Date();
    await invitations.updateMany(
      { teamId, kind: 'link', status: 'pending' },
      { $set: { status: 'revoked', revokedAt: now, updatedAt: now } },
    );

    const token = generateInvitationToken();
    const expiresAt = new Date(now.getTime() + INVITATION_LIFETIME_MS);
    const doc = {
      _id: new ObjectId(),
      teamId,
      email: null,
      kind: 'link',
      tokenHash: hashInvitationToken(token),
      invitedBy: identity.userId,
      status: 'pending',
      useCount: 0,
      createdAt: now,
      updatedAt: now,
      expiresAt,
    };
    try {
      await invitations.insertOne(doc);
    } catch (error) {
      // Two admins generating at once: both retired the old link, then both
      // inserted against the one-pending-invitation-per-team index.
      if (error?.code === 11000) {
        throw new Meteor.Error(
          'invitation-exists',
          'Another admin just generated a link for this team. Reopen Share to see it.',
        );
      }
      throw error;
    }

    return {
      link: {
        invitationId: doc._id.toHexString(),
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        useCount: 0,
      },
      url: inviteLinkUrl(token),
    };
  },

  /**
   * The active invite link's status, without its URL: only the token's hash is
   * stored, so the link itself is unrecoverable once the admin who minted it
   * navigates away.
   */
  async 'teams.getInviteLink'({ teamId }) {
    const identity = await requireIdentity(this);
    await requireTeamAdmin(teamId, identity.userId);
    const link = await rawDb().collection('team_invitations').findOne({
      teamId,
      kind: 'link',
      status: 'pending',
      expiresAt: { $gt: new Date() },
    });
    if (!link) return { link: null };
    return {
      link: {
        invitationId: link._id.toHexString(),
        createdAt: link.createdAt.toISOString(),
        expiresAt: link.expiresAt.toISOString(),
        useCount: link.useCount ?? 0,
      },
    };
  },

  /**
   * Issue the team a new code. Everything shared with the old one stops
   * naming this team, which is the point: the codes minted before this release
   * came from a predictable generator, and a team that auto-accepts join
   * requests admits anyone holding one.
   */
  async 'teams.rotateCode'({ teamId }) {
    const identity = await requireIdentity(this);
    const team = await requireTeamAdmin(teamId, identity.userId);
    if (team.isPersonal) {
      throw new Meteor.Error('forbidden', 'A personal workspace has no join code.');
    }
    const code = generateTeamCode();
    await Teams.updateAsync(team._id, { $set: { code, updatedAt: new Date() } });
    return { code };
  },

  async 'teams.removeMember'({ teamId, userId: targetUserId }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(teamId)) throw new Meteor.Error('not-found', 'Invalid team id');
    const team = await Teams.findOneAsync(new Mongo.ObjectID(teamId));
    if (!team) throw new Meteor.Error('not-found', 'Team not found');
    if (!(await isTeamAdminOrOrgOwner(team, userId))) {
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
    if (!(await isTeamAdminOrOrgOwner(team, userId))) {
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
    if (!(await isTeamAdminOrOrgOwner(team, userId))) {
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
