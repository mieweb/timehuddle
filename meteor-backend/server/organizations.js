import { Meteor } from 'meteor/meteor';
import { MongoInternals } from 'meteor/mongo';
import { Teams, rawDb, isValidId } from './collections';
import { requireIdentity } from './auth-bridge';
import {
  ensureDefaultOrganization,
  addOrgMember,
  getAccessibleOrgIds,
} from './org-helpers';
import { buildAbilityFor } from './permissions';
import { subject } from '@casl/ability';
import { emitActivity, ActivityType } from './activity-core';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

const DEFAULT_ORG_KEY = process.env.DEFAULT_ORG_KEY || 'default';
const ELEVATED_ROLES = ['owner', 'admin'];

function slugify(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-').slice(0, 64);
}

function uniqueIds(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

async function getOrgMembership(orgId, userId) {
  const m = await rawDb().collection('org_members').findOne({ orgId, userId });
  if (!m) return null;
  return { orgId: m.orgId, userId: m.userId, role: m.role, auto: m.auto };
}

async function getEnterpriseRoleForOrg(userId, org) {
  if (!org.enterpriseId || !isValidId(org.enterpriseId)) return null;
  const ent = await rawDb().collection('enterprises').findOne({ _id: new ObjectId(org.enterpriseId) });
  if (!ent) return null;
  if ((ent.owners ?? []).includes(userId)) return 'owner';
  if ((ent.admins ?? []).includes(userId)) return 'admin';
  return null;
}

async function buildOrgAccess(userId, org) {
  const orgId = org._id.toHexString();
  const membership = await getOrgMembership(orgId, userId);
  const enterpriseRole = await getEnterpriseRoleForOrg(userId, org);
  const isOrgElevated = !!membership && ELEVATED_ROLES.includes(membership.role);
  const managedOrgIds = isOrgElevated || enterpriseRole ? [orgId] : [];
  const role = membership?.role ?? enterpriseRole ?? 'member';
  const ability = buildAbilityFor({
    userId,
    role,
    teamIds: [],
    orgIds: membership || enterpriseRole ? [orgId] : [],
    managedOrgIds,
    enterpriseIds: enterpriseRole && org.enterpriseId ? [org.enterpriseId] : [],
    isEnterpriseElevated: !!enterpriseRole,
  });
  const canManage = ability.can('manage', subject('OrganizationMembership', { orgId }));
  return {
    ability,
    canManage,
    role: isOrgElevated ? membership.role : (enterpriseRole ?? membership?.role ?? null),
  };
}

function toOrgSummary(org, role) {
  return {
    id: org._id.toHexString(),
    enterpriseId: org.enterpriseId ?? null,
    name: org.name,
    slug: org.slug,
    allowAutoJoin: org.allowAutoJoin !== false,
    role,
  };
}

async function loadOrgMembers(orgId) {
  const db = rawDb();
  const org = await db.collection('organizations').findOne({ _id: new ObjectId(orgId) });
  if (!org) return [];

  // Get members from org_members collection
  const membershipDocs = await db.collection('org_members').find({ orgId }).toArray();
  
  // Get all team members from teams in this org
  const teamDocs = await db.collection('teams')
    .find({ orgId }, { projection: { members: 1, admins: 1 } })
    .toArray();
  const teamMemberIds = new Set();
  for (const team of teamDocs) {
    for (const memberId of team.members || []) teamMemberIds.add(memberId);
    for (const adminId of team.admins || []) teamMemberIds.add(adminId);
  }

  // Combine org legacy owners/admins
  const legacyIds = uniqueIds([...(org.owners ?? []), ...(org.admins ?? [])]);
  
  // Build complete member list
  const allMemberIds = new Set([
    ...membershipDocs.map((m) => m.userId),
    ...legacyIds,
    ...teamMemberIds,
  ]);
  
  const allMembers = Array.from(allMemberIds).map((userId) => {
    const membership = membershipDocs.find((m) => m.userId === userId);
    if (membership) {
      return { userId, role: membership.role, auto: membership.auto };
    }
    // Check legacy arrays
    if ((org.owners ?? []).includes(userId)) {
      return { userId, role: 'owner', auto: false };
    }
    if ((org.admins ?? []).includes(userId)) {
      return { userId, role: 'admin', auto: false };
    }
    // Team member without explicit org membership
    return { userId, role: 'member', auto: true };
  });

  const memberIds = allMembers.map((m) => String(m.userId)).filter(Boolean);
  const meteorUsers = memberIds.length > 0
    ? await db.collection('users')
        .find({ _id: { $in: memberIds } }, { projection: { profile: 1, emails: 1, username: 1, image: 1, reportsToUserId: 1, blocked: 1 } })
        .toArray()
    : [];

  const byId = new Map(meteorUsers.map((u) => [String(u._id), {
    _id: u._id,
    name: u.profile?.name ?? u.username ?? 'Unknown',
    email: u.emails?.[0]?.address ?? '',
    username: u.username ?? null,
    image: u.image ?? null,
    reportsToUserId: u.reportsToUserId ?? null,
    blocked: u.blocked ?? [],
  }]));

  return allMembers
    .map((m) => {
      const u = byId.get(m.userId);
      if (!u) return null;
      return {
        id: m.userId,
        name: u.name,
        email: u.email,
        username: u.username ?? null,
        image: u.image ?? null,
        reportsToUserId: u.reportsToUserId ?? null,
        role: m.role,
        auto: m.auto,
        blocked: u.blocked ?? [],
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
}

async function requireDefaultOrgAdmin(userId) {
  const db = rawDb();
  const defaultOrg = await db.collection('organizations').findOne({ slug: DEFAULT_ORG_KEY });
  if (!defaultOrg) throw new Meteor.Error('not-found', 'Default organization not found');
  const membership = await db.collection('org_members').findOne({ orgId: defaultOrg._id.toHexString(), userId });
  if (membership?.role === 'owner' || membership?.role === 'admin') return defaultOrg;
  if ((defaultOrg.owners ?? []).includes(userId)) return defaultOrg;
  if ((defaultOrg.admins ?? []).includes(userId)) return defaultOrg;
  throw new Meteor.Error('forbidden', 'Requires default organization owner or admin');
}

function resolveDefaultOrgRole(owners, admins, userId) {
  if (owners.includes(userId)) return 'owner';
  if (admins.includes(userId)) return 'admin';
  return 'member';
}

Meteor.methods({
  // ── Org CRUD ──────────────────────────────────────────────────────────────

  async 'orgs.list'() {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    const db = rawDb();
    let orgIds = await getAccessibleOrgIds(userId);
    if (orgIds.length === 0) return { organizations: [] };

    // Filter out blocked orgs
    const userDoc = await db.collection('users').findOne(
      { _id: String(userId) },
      { projection: { blocked: 1 } }
    );
    const blockedOrgIds = new Set((userDoc?.blocked ?? []).map((b) => b.orgId));
    orgIds = orgIds.filter((id) => !blockedOrgIds.has(id));
    if (orgIds.length === 0) return { organizations: [] };

    const validIds = orgIds.filter(isValidId).map((id) => new ObjectId(id));
    const organizations = await db.collection('organizations')
      .find({ _id: { $in: validIds } })
      .sort({ name: 1 })
      .toArray();

    const summaries = await Promise.all(
      organizations.map(async (org) => {
        const membership = await getOrgMembership(org._id.toHexString(), userId);
        if (membership) return toOrgSummary(org, membership.role);
        const entRole = await getEnterpriseRoleForOrg(userId, org);
        return toOrgSummary(org, entRole ?? 'member');
      }),
    );
    return { organizations: summaries.sort((a, b) => a.name.localeCompare(b.name)) };
  },

  async 'orgs.checkSlug'({ slug, excludeId }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (typeof slug !== 'string') return { available: false };
    const filter = { slug };
    if (excludeId && isValidId(excludeId)) filter._id = { $ne: new ObjectId(excludeId) };
    const existing = await rawDb().collection('organizations').findOne(filter, { projection: { _id: 1 } });
    return { available: !existing };
  },

  async 'orgs.create'({ enterpriseId, name, slug: inputSlug, allowAutoJoin }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(enterpriseId)) throw new Meteor.Error('not-found', 'Invalid enterpriseId');
    const db = rawDb();
    const enterprise = await db.collection('enterprises').findOne({ _id: new ObjectId(enterpriseId) });
    if (!enterprise) throw new Meteor.Error('not-found', 'Enterprise not found');
    const isEntAdmin = (enterprise.owners ?? []).includes(userId) || (enterprise.admins ?? []).includes(userId);
    if (!isEntAdmin) throw new Meteor.Error('forbidden', 'Enterprise admin required');

    const trimmedName = (name ?? '').trim();
    if (!trimmedName) throw new Meteor.Error('bad-request', 'name is required');
    const slug = slugify(inputSlug ?? trimmedName) || `org-${Date.now()}`;
    const conflict = await db.collection('organizations').findOne({ slug });
    if (conflict) throw new Meteor.Error('conflict', 'Slug already taken');

    const now = new Date();
    const org = {
      _id: new ObjectId(),
      enterpriseId,
      slug,
      name: trimmedName,
      owners: [userId],
      admins: [],
      allowAutoJoin: allowAutoJoin !== false,
      createdAt: now,
      updatedAt: now,
    };
    await db.collection('organizations').insertOne(org);
    await addOrgMember(org._id.toHexString(), userId, 'owner', false);
    return { organization: toOrgSummary(org, 'owner') };
  },

  async 'orgs.get'({ orgId }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(orgId)) throw new Meteor.Error('not-found', 'Invalid orgId');
    const org = await rawDb().collection('organizations').findOne({ _id: new ObjectId(orgId) });
    if (!org) throw new Meteor.Error('not-found', 'Organization not found');
    const accessible = await getAccessibleOrgIds(userId);
    if (!accessible.includes(orgId)) throw new Meteor.Error('forbidden', 'Not accessible');
    const membership = await getOrgMembership(orgId, userId);
    const entRole = await getEnterpriseRoleForOrg(userId, org);
    const access = await buildOrgAccess(userId, org);
    return {
      organization: {
        ...toOrgSummary(org, membership?.role ?? entRole ?? 'member'),
        canManage: access.canManage,
      },
    };
  },

  async 'orgs.update'({ orgId, name, slug: inputSlug, allowAutoJoin }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(orgId)) throw new Meteor.Error('not-found', 'Invalid orgId');
    const db = rawDb();
    const org = await db.collection('organizations').findOne({ _id: new ObjectId(orgId) });
    if (!org) throw new Meteor.Error('not-found', 'Organization not found');
    const access = await buildOrgAccess(userId, org);
    if (!access.canManage) throw new Meteor.Error('forbidden', 'Manage permission required');

    const updates = { updatedAt: new Date() };
    if (name !== undefined) {
      const trimmed = name.trim();
      if (trimmed) updates.name = trimmed;
    }
    if (inputSlug !== undefined) {
      const newSlug = slugify(inputSlug) || org.slug;
      if (newSlug !== org.slug) {
        const conflict = await db.collection('organizations').findOne({ slug: newSlug, _id: { $ne: new ObjectId(orgId) } }, { projection: { _id: 1 } });
        if (conflict) throw new Meteor.Error('conflict', 'Slug already taken');
      }
      updates.slug = newSlug;
    }
    if (allowAutoJoin !== undefined) updates.allowAutoJoin = allowAutoJoin;

    await db.collection('organizations').updateOne({ _id: new ObjectId(orgId) }, { $set: updates });
    const updated = await db.collection('organizations').findOne({ _id: new ObjectId(orgId) });
    return { organization: toOrgSummary(updated, access.role) };
  },

  async 'orgs.updateSettings'({ orgId, allowAutoJoin }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(orgId)) throw new Meteor.Error('not-found', 'Invalid orgId');
    if (typeof allowAutoJoin !== 'boolean') throw new Meteor.Error('bad-request', 'allowAutoJoin is required');
    const db = rawDb();
    const org = await db.collection('organizations').findOne({ _id: new ObjectId(orgId) });
    if (!org) throw new Meteor.Error('not-found', 'Organization not found');
    const access = await buildOrgAccess(userId, org);
    if (!access.canManage) throw new Meteor.Error('forbidden', 'Manage permission required');

    const result = await db.collection('organizations').findOneAndUpdate(
      { _id: new ObjectId(orgId) },
      { $set: { allowAutoJoin, updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
    return { organization: { orgId: result._id.toHexString(), allowAutoJoin: result.allowAutoJoin !== false } };
  },

  async 'orgs.join'({ orgId }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(orgId)) throw new Meteor.Error('not-found', 'Invalid orgId');
    const org = await rawDb().collection('organizations').findOne({ _id: new ObjectId(orgId) });
    if (!org) throw new Meteor.Error('not-found', 'Organization not found');
    if (org.allowAutoJoin === false) throw new Meteor.Error('forbidden', 'Auto-join is disabled');
    const membership = await addOrgMember(orgId, userId, 'member', true);
    if (membership === 'not-found') throw new Meteor.Error('not-found', 'Organization not found');
    return { membership: { orgId: membership.orgId, role: membership.role } };
  },

  // ── Org members ───────────────────────────────────────────────────────────

  async 'orgs.listMembers'({ orgId }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(orgId)) throw new Meteor.Error('not-found', 'Invalid orgId');
    const org = await rawDb().collection('organizations').findOne({ _id: new ObjectId(orgId) });
    if (!org) throw new Meteor.Error('not-found', 'Organization not found');
    const access = await buildOrgAccess(userId, org);
    if (!access.canManage) throw new Meteor.Error('forbidden', 'Manage permission required');
    return { users: await loadOrgMembers(orgId) };
  },

  async 'orgs.listUsers'({ orgId }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(orgId)) throw new Meteor.Error('not-found', 'Invalid orgId');
    const accessible = await getAccessibleOrgIds(userId);
    if (!accessible.includes(orgId)) throw new Meteor.Error('forbidden', 'Not accessible');
    return { users: await loadOrgMembers(orgId) };
  },

  async 'orgs.searchUsers'({ orgId, q }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(orgId)) throw new Meteor.Error('not-found', 'Invalid orgId');
    const org = await rawDb().collection('organizations').findOne({ _id: new ObjectId(orgId) });
    if (!org) throw new Meteor.Error('not-found', 'Organization not found');
    const access = await buildOrgAccess(userId, org);
    if (!access.canManage) throw new Meteor.Error('forbidden', 'Manage permission required');

    const query = (q ?? '').trim();
    const filter = query
      ? { $or: [
          { 'profile.name': { $regex: query, $options: 'i' } },
          { username: { $regex: query, $options: 'i' } },
          { 'emails.address': { $regex: query, $options: 'i' } },
        ] }
      : {};
    const users = await rawDb().collection('users')
      .find(filter, { projection: { _id: 1, profile: 1, username: 1 } })
      .sort({ 'profile.name': 1 })
      .limit(20)
      .toArray();
    return { users: users.map((u) => ({ id: String(u._id), name: u.profile?.name ?? 'Unknown', username: u.username ?? null })) };
  },

  async 'orgs.setMemberRole'({ orgId, userId, role }) {
    const identity = await requireIdentity(this);
    const currentUserId = identity.userId;
    if (!isValidId(orgId)) throw new Meteor.Error('not-found', 'Invalid orgId');
    if (!isValidId(userId)) throw new Meteor.Error('not-found', 'Invalid userId');
    if (!['owner', 'admin', 'member'].includes(role)) throw new Meteor.Error('bad-request', 'Invalid role');
    const db = rawDb();
    const [org, targetUser, membershipDocs] = await Promise.all([
      db.collection('organizations').findOne({ _id: new ObjectId(orgId) }),
      db.collection('users').findOne({ _id: String(userId) }),
      db.collection('org_members').find({ orgId }).toArray(),
    ]);
    if (!org) throw new Meteor.Error('not-found', 'Organization not found');
    const access = await buildOrgAccess(currentUserId, org);
    if (!access.canManage) throw new Meteor.Error('forbidden', 'Manage permission required');
    if (!targetUser) throw new Meteor.Error('not-found', 'User not found');

    const elevatedIds = new Set([
      ...(org.owners ?? []),
      ...(org.admins ?? []),
      ...membershipDocs.filter((m) => ELEVATED_ROLES.includes(m.role)).map((m) => m.userId),
    ]);
    const current = await getOrgMembership(orgId, userId);
    if (current && ELEVATED_ROLES.includes(current.role) && role === 'member' && elevatedIds.size === 1 && elevatedIds.has(userId)) {
      throw new Meteor.Error('last-elevated', 'At least one owner or admin required');
    }

    await addOrgMember(orgId, userId, role, false);
    return { user: { userId, role } };
  },

  async 'orgs.removeMember'({ orgId, userId }) {
    const identity = await requireIdentity(this);
    const currentUserId = identity.userId;
    if (!isValidId(orgId)) throw new Meteor.Error('not-found', 'Invalid orgId');
    if (!isValidId(userId)) throw new Meteor.Error('not-found', 'Invalid userId');
    const db = rawDb();
    const [org, targetUser, membershipDocs] = await Promise.all([
      db.collection('organizations').findOne({ _id: new ObjectId(orgId) }),
      db.collection('users').findOne({ _id: String(userId) }),
      db.collection('org_members').find({ orgId }).toArray(),
    ]);
    if (!org) throw new Meteor.Error('not-found', 'Organization not found');
    const access = await buildOrgAccess(currentUserId, org);
    if (!access.canManage) throw new Meteor.Error('forbidden', 'Manage permission required');
    if (!targetUser) throw new Meteor.Error('not-found', 'User not found');

    const current = await getOrgMembership(orgId, userId);
    if (!current) throw new Meteor.Error('not-member', 'Not an org member');

    const elevatedIds = new Set([
      ...(org.owners ?? []),
      ...(org.admins ?? []),
      ...membershipDocs.filter((m) => ELEVATED_ROLES.includes(m.role)).map((m) => m.userId),
    ]);
    if (ELEVATED_ROLES.includes(current.role) && elevatedIds.size === 1 && elevatedIds.has(userId)) {
      throw new Meteor.Error('last-elevated', 'At least one owner or admin required');
    }

    await db.collection('org_members').deleteMany({ orgId, userId });
    // Sync legacy arrays to remove from owners/admins
    await db.collection('organizations').updateOne(
      { _id: new ObjectId(orgId) },
      { $pull: { owners: userId, admins: userId }, $set: { updatedAt: new Date() } },
    );
    return { user: { userId } };
  },

  async 'orgs.blockMember'({ orgId, targetUserId, reason }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(orgId)) throw new Meteor.Error('not-found', 'Invalid orgId');
    if (!isValidId(targetUserId)) throw new Meteor.Error('not-found', 'Invalid targetUserId');
    const db = rawDb();
    const org = await db.collection('organizations').findOne({ _id: new ObjectId(orgId) });
    if (!org) throw new Meteor.Error('not-found', 'Organization not found');
    const access = await buildOrgAccess(userId, org);
    if (!access.canManage) throw new Meteor.Error('forbidden', 'Manage permission required');

    const targetUser = await db.collection('users').findOne({ _id: String(targetUserId) });
    if (!targetUser) {
      throw new Meteor.Error('not-found', 'Target user not found');
    }

    const alreadyBlocked = (targetUser.blocked ?? []).some((b) => b.orgId === orgId);
    if (alreadyBlocked) {
      throw new Meteor.Error('already-blocked', 'User is already blocked from this organization');
    }

    const block = {
      orgId,
      blockedBy: userId,
      blockedAt: new Date(),
      reason: reason ?? null,
    };

    await db.collection('users').updateOne(
      { _id: String(targetUserId) },
      { $push: { blocked: block } }
    );

    // Remove from all teams in this org
    await db.collection('teams').updateMany(
      { orgId, $or: [{ members: targetUserId }, { admins: targetUserId }] },
      { $pull: { members: targetUserId, admins: targetUserId } }
    );

    // Keep user in org_members so they remain visible (can be unblocked later)
    // They're blocked from access via the user.blocked field

    // Remove from legacy org arrays
    await db.collection('organizations').updateOne(
      { _id: new ObjectId(orgId) },
      { $pull: { owners: targetUserId, admins: targetUserId }, $set: { updatedAt: new Date() } }
    );

    // Fire-and-forget activity
    void emitActivity({
      type: ActivityType.OrgMemberBlocked,
      userId: targetUserId,
      actor: userId,
      payload: {
        orgId,
        orgName: org.name,
        targetUserId,
        targetUserName: targetUser.profile?.name ?? targetUser.emails?.[0]?.address ?? 'Unknown',
        reason: reason ?? null,
      },
    });

    return {
      user: {
        id: targetUserId,
        blocked: {
          orgId,
          blockedBy: userId,
          blockedAt: block.blockedAt.toISOString(),
          reason: reason ?? null,
        },
      },
    };
  },

  async 'orgs.unblockMember'({ orgId, targetUserId }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(orgId)) throw new Meteor.Error('not-found', 'Invalid orgId');
    if (!isValidId(targetUserId)) throw new Meteor.Error('not-found', 'Invalid targetUserId');
    const db = rawDb();
    const org = await db.collection('organizations').findOne({ _id: new ObjectId(orgId) });
    if (!org) throw new Meteor.Error('not-found', 'Organization not found');
    const access = await buildOrgAccess(userId, org);
    if (!access.canManage) throw new Meteor.Error('forbidden', 'Manage permission required');

    const targetUser = await db.collection('users').findOne({ _id: String(targetUserId) });
    if (!targetUser) {
      throw new Meteor.Error('not-found', 'Target user not found');
    }

    const isBlocked = (targetUser.blocked ?? []).some((b) => b.orgId === orgId);
    if (!isBlocked) {
      throw new Meteor.Error('not-blocked', 'User is not blocked from this organization');
    }

    await db.collection('users').updateOne(
      { _id: String(targetUserId) },
      { $pull: { blocked: { orgId } } }
    );

    // Fire-and-forget activity
    void emitActivity({
      type: ActivityType.OrgMemberUnblocked,
      userId: targetUserId,
      actor: userId,
      payload: {
        orgId,
        orgName: org.name,
        targetUserId,
        targetUserName: targetUser.profile?.name ?? targetUser.emails?.[0]?.address ?? 'Unknown',
      },
    });

    return { user: { id: targetUserId } };
  },

  async 'orgs.updateMemberReportsTo'({ orgId, userId, reportsToUserId }) {
    const identity = await requireIdentity(this);
    const currentUserId = identity.userId;
    if (!isValidId(orgId)) throw new Meteor.Error('not-found', 'Invalid orgId');
    if (!isValidId(userId)) throw new Meteor.Error('not-found', 'Invalid userId');
    const org = await rawDb().collection('organizations').findOne({ _id: new ObjectId(orgId) });
    if (!org) throw new Meteor.Error('not-found', 'Organization not found');
    const access = await buildOrgAccess(currentUserId, org);
    if (!access.canManage) throw new Meteor.Error('forbidden', 'Manage permission required');

    const targetMembership = await getOrgMembership(orgId, userId);
    if (!targetMembership) throw new Meteor.Error('not-member', 'Not an org member');

    if (reportsToUserId !== undefined && reportsToUserId !== null) {
      if (!isValidId(reportsToUserId)) throw new Meteor.Error('not-found', 'Reports-to user not found');
      if (reportsToUserId === userId) throw new Meteor.Error('bad-request', 'Cannot report to self');
      const rtMembership = await getOrgMembership(orgId, reportsToUserId);
      if (!rtMembership) throw new Meteor.Error('not-found', 'Reports-to user not in org');
    }

    await rawDb().collection('users').updateOne(
      { _id: String(userId) },
      { $set: { reportsToUserId: reportsToUserId ?? null, updatedAt: new Date() } },
    );
    return { user: { id: userId, reportsToUserId: reportsToUserId ?? null } };
  },

  async 'orgs.updateReportsTo'({ userId, reportsToUserId }) {
    const identity = await requireIdentity(this);
    const currentUserId = identity.userId;
    if (!isValidId(userId)) throw new Meteor.Error('not-found', 'Invalid userId');
    const defaultOrg = await requireDefaultOrgAdmin(currentUserId);
    const user = await rawDb().collection('users').findOne({ _id: String(userId) });
    if (!user) throw new Meteor.Error('not-found', 'User not found');

    if (reportsToUserId !== undefined && reportsToUserId !== null) {
      if (!isValidId(reportsToUserId)) throw new Meteor.Error('not-found', 'Reports-to user not found');
      const rtUser = await rawDb().collection('users').findOne({ _id: String(reportsToUserId) });
      if (!rtUser) throw new Meteor.Error('not-found', 'Reports-to user not found');
    }

    await rawDb().collection('users').updateOne(
      { _id: String(userId) },
      { $set: { reportsToUserId: reportsToUserId ?? null, updatedAt: new Date() } },
    );
    return { user: { userId, reportsToUserId: reportsToUserId ?? null } };
  },

  async 'orgs.listBlockedUsers'({ orgId }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(orgId)) throw new Meteor.Error('not-found', 'Invalid orgId');
    const db = rawDb();
    const org = await db.collection('organizations').findOne({ _id: new ObjectId(orgId) });
    if (!org) throw new Meteor.Error('not-found', 'Organization not found');
    const access = await buildOrgAccess(userId, org);
    if (!access.canManage) throw new Meteor.Error('forbidden', 'Manage permission required');

    // Find all users who have this orgId in their blocked array
    const blockedUsers = await db.collection('users')
      .find(
        { blocked: { $elemMatch: { orgId } } },
        { projection: { profile: 1, emails: 1, username: 1, image: 1, blocked: 1 } }
      )
      .toArray();

    const allBlockedUsers = blockedUsers.map((u) => ({
      id: String(u._id),
      name: u.profile?.name ?? u.username ?? 'Unknown',
      email: u.emails?.[0]?.address ?? '',
      username: u.username ?? null,
      image: u.image ?? null,
      blocked: u.blocked ?? [],
    }));

    return { users: allBlockedUsers };
  },

  // ── Default org admin endpoints (from users.ts) ───────────────────────────

  async 'orgs.adminGet'() {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    const defaultOrg = await requireDefaultOrgAdmin(userId);
    return {
      organization: {
        id: defaultOrg._id.toHexString(),
        slug: defaultOrg.slug,
        name: defaultOrg.name,
        ownersCount: (defaultOrg.owners ?? []).length,
        adminsCount: (defaultOrg.admins ?? []).length,
      },
    };
  },

  async 'orgs.adminUpdate'({ name }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    const defaultOrg = await requireDefaultOrgAdmin(userId);
    const nextName = (name ?? '').trim();
    if (!nextName) throw new Meteor.Error('bad-request', 'Organization name is required');
    await rawDb().collection('organizations').updateOne(
      { _id: defaultOrg._id },
      { $set: { name: nextName, updatedAt: new Date() } },
    );
    return { organization: { id: defaultOrg._id.toHexString(), slug: defaultOrg.slug, name: nextName } };
  },

  async 'orgs.adminListUsers'() {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    const defaultOrg = await requireDefaultOrgAdmin(userId);
    const owners = defaultOrg.owners ?? [];
    const admins = defaultOrg.admins ?? [];
    const users = await rawDb().collection('users')
      .find({}, { projection: { profile: 1, emails: 1, username: 1, image: 1, reportsToUserId: 1 } })
      .sort({ 'profile.name': 1 })
      .limit(500)
      .toArray();
    return {
      users: users.map((u) => ({
        id: String(u._id),
        name: u.profile?.name ?? 'Unknown',
        email: u.emails?.[0]?.address ?? '',
        username: u.username ?? null,
        image: u.image ?? null,
        reportsToUserId: u.reportsToUserId ?? null,
        role: resolveDefaultOrgRole(owners, admins, String(u._id)),
      })),
    };
  },

  async 'orgs.adminSetUserRole'({ userId, role }) {
    const identity = await requireIdentity(this);
    const currentUserId = identity.userId;
    if (!isValidId(userId)) throw new Meteor.Error('not-found', 'Invalid userId');
    if (!['owner', 'admin', 'member'].includes(role)) throw new Meteor.Error('bad-request', 'Invalid role');
    const defaultOrg = await requireDefaultOrgAdmin(currentUserId);
    const db = rawDb();
    const targetUser = await db.collection('users').findOne({ _id: String(userId) });
    if (!targetUser) throw new Meteor.Error('not-found', 'User not found');

    const owners = new Set(defaultOrg.owners ?? []);
    const admins = new Set(defaultOrg.admins ?? []);
    owners.delete(userId);
    admins.delete(userId);
    if (role === 'owner') owners.add(userId);
    if (role === 'admin') admins.add(userId);
    if (new Set([...owners, ...admins]).size === 0) {
      throw new Meteor.Error('bad-request', 'At least one owner or admin is required');
    }

    await db.collection('organizations').updateOne(
      { _id: defaultOrg._id },
      { $set: { owners: Array.from(owners), admins: Array.from(admins), updatedAt: new Date() } },
    );
    return { user: { id: userId, role } };
  },

  // ── Public org endpoints ──────────────────────────────────────────────────

  async 'orgs.publicGet'() {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    const defaultOrg = await rawDb().collection('organizations').findOne({ slug: DEFAULT_ORG_KEY });
    if (!defaultOrg) throw new Meteor.Error('not-found', 'Default organization not found');
    return { organization: { id: defaultOrg._id.toHexString(), slug: defaultOrg.slug, name: defaultOrg.name } };
  },

  async 'orgs.publicListUsers'() {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    const defaultOrg = await rawDb().collection('organizations').findOne({ slug: DEFAULT_ORG_KEY });
    if (!defaultOrg) throw new Meteor.Error('not-found', 'Organization not found');
    const owners = defaultOrg.owners ?? [];
    const admins = defaultOrg.admins ?? [];
    const users = await rawDb().collection('users')
      .find({}, { projection: { profile: 1, emails: 1, username: 1, image: 1, reportsToUserId: 1 } })
      .sort({ 'profile.name': 1 })
      .limit(500)
      .toArray();
    return {
      users: users.map((u) => ({
        id: String(u._id),
        name: u.profile?.name ?? 'Unknown',
        email: u.emails?.[0]?.address ?? '',
        username: u.username ?? null,
        image: u.image ?? null,
        reportsToUserId: u.reportsToUserId ?? null,
        role: resolveDefaultOrgRole(owners, admins, String(u._id)),
      })),
    };
  },
});
// ─── Publications ─────────────────────────────────────────────────────────────

import { OrgMembers } from './collections.js';

/** Live org members for accessible orgs. */
Meteor.publish('orgMembers.byOrg', async function (orgId) {
  if (!this.userId) return this.ready();
  if (!isValidId(orgId)) return this.ready();
  
  const db = rawDb();
  const org = await db.collection('organizations').findOne({ _id: new ObjectId(orgId) });
  if (!org) return this.ready();
  
  const access = await buildOrgAccess(this.userId, org);
  if (!access.canManage && !access.role) return this.ready();
  
  return OrgMembers.find({ orgId });
});