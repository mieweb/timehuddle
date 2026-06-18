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

  const membershipDocs = await db.collection('org_members').find({ orgId }).toArray();
  const legacyIds = uniqueIds([...(org.owners ?? []), ...(org.admins ?? [])]);
  const missingLegacyIds = legacyIds.filter(
    (uid) => !membershipDocs.some((m) => m.userId === uid),
  );
  const allMembers = [
    ...membershipDocs.map((m) => ({ userId: m.userId, role: m.role, auto: m.auto })),
    ...missingLegacyIds.map((uid) => ({
      userId: uid,
      role: (org.owners ?? []).includes(uid) ? 'owner' : 'admin',
      auto: false,
    })),
  ];

  const validUserIds = allMembers.filter((m) => isValidId(m.userId)).map((m) => new ObjectId(m.userId));
  const users = await db.collection('user')
    .find({ _id: { $in: validUserIds } }, { projection: { name: 1, email: 1, username: 1, image: 1, reportsToUserId: 1 } })
    .toArray();
  const byId = new Map(users.map((u) => [u._id.toHexString(), u]));

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
    const db = rawDb();
    const orgIds = await getAccessibleOrgIds(identity.userId);
    if (orgIds.length === 0) return { organizations: [] };

    const validIds = orgIds.filter(isValidId).map((id) => new ObjectId(id));
    const organizations = await db.collection('organizations')
      .find({ _id: { $in: validIds } })
      .sort({ name: 1 })
      .toArray();

    const summaries = await Promise.all(
      organizations.map(async (org) => {
        const membership = await getOrgMembership(org._id.toHexString(), identity.userId);
        if (membership) return toOrgSummary(org, membership.role);
        const entRole = await getEnterpriseRoleForOrg(identity.userId, org);
        return toOrgSummary(org, entRole ?? 'member');
      }),
    );
    return { organizations: summaries.sort((a, b) => a.name.localeCompare(b.name)) };
  },

  async 'orgs.checkSlug'({ slug, excludeId }) {
    await requireIdentity(this);
    if (typeof slug !== 'string') return { available: false };
    const filter = { slug };
    if (excludeId && isValidId(excludeId)) filter._id = { $ne: new ObjectId(excludeId) };
    const existing = await rawDb().collection('organizations').findOne(filter, { projection: { _id: 1 } });
    return { available: !existing };
  },

  async 'orgs.create'({ enterpriseId, name, slug: inputSlug, allowAutoJoin }) {
    const identity = await requireIdentity(this);
    if (!isValidId(enterpriseId)) throw new Meteor.Error('not-found', 'Invalid enterpriseId');
    const db = rawDb();
    const enterprise = await db.collection('enterprises').findOne({ _id: new ObjectId(enterpriseId) });
    if (!enterprise) throw new Meteor.Error('not-found', 'Enterprise not found');
    const isEntAdmin = (enterprise.owners ?? []).includes(identity.userId) || (enterprise.admins ?? []).includes(identity.userId);
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
      owners: [identity.userId],
      admins: [],
      allowAutoJoin: allowAutoJoin !== false,
      createdAt: now,
      updatedAt: now,
    };
    await db.collection('organizations').insertOne(org);
    await addOrgMember(org._id.toHexString(), identity.userId, 'owner', false);
    return { organization: toOrgSummary(org, 'owner') };
  },

  async 'orgs.get'({ orgId }) {
    const identity = await requireIdentity(this);
    if (!isValidId(orgId)) throw new Meteor.Error('not-found', 'Invalid orgId');
    const org = await rawDb().collection('organizations').findOne({ _id: new ObjectId(orgId) });
    if (!org) throw new Meteor.Error('not-found', 'Organization not found');
    const accessible = await getAccessibleOrgIds(identity.userId);
    if (!accessible.includes(orgId)) throw new Meteor.Error('forbidden', 'Not accessible');
    const membership = await getOrgMembership(orgId, identity.userId);
    const entRole = await getEnterpriseRoleForOrg(identity.userId, org);
    const access = await buildOrgAccess(identity.userId, org);
    return {
      organization: {
        ...toOrgSummary(org, membership?.role ?? entRole ?? 'member'),
        canManage: access.canManage,
      },
    };
  },

  async 'orgs.update'({ orgId, name, slug: inputSlug, allowAutoJoin }) {
    const identity = await requireIdentity(this);
    if (!isValidId(orgId)) throw new Meteor.Error('not-found', 'Invalid orgId');
    const db = rawDb();
    const org = await db.collection('organizations').findOne({ _id: new ObjectId(orgId) });
    if (!org) throw new Meteor.Error('not-found', 'Organization not found');
    const access = await buildOrgAccess(identity.userId, org);
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
    if (!isValidId(orgId)) throw new Meteor.Error('not-found', 'Invalid orgId');
    if (typeof allowAutoJoin !== 'boolean') throw new Meteor.Error('bad-request', 'allowAutoJoin is required');
    const db = rawDb();
    const org = await db.collection('organizations').findOne({ _id: new ObjectId(orgId) });
    if (!org) throw new Meteor.Error('not-found', 'Organization not found');
    const access = await buildOrgAccess(identity.userId, org);
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
    if (!isValidId(orgId)) throw new Meteor.Error('not-found', 'Invalid orgId');
    const org = await rawDb().collection('organizations').findOne({ _id: new ObjectId(orgId) });
    if (!org) throw new Meteor.Error('not-found', 'Organization not found');
    if (org.allowAutoJoin === false) throw new Meteor.Error('forbidden', 'Auto-join is disabled');
    const membership = await addOrgMember(orgId, identity.userId, 'member', true);
    if (membership === 'not-found') throw new Meteor.Error('not-found', 'Organization not found');
    return { membership: { orgId: membership.orgId, role: membership.role } };
  },

  // ── Org members ───────────────────────────────────────────────────────────

  async 'orgs.listMembers'({ orgId }) {
    const identity = await requireIdentity(this);
    if (!isValidId(orgId)) throw new Meteor.Error('not-found', 'Invalid orgId');
    const org = await rawDb().collection('organizations').findOne({ _id: new ObjectId(orgId) });
    if (!org) throw new Meteor.Error('not-found', 'Organization not found');
    const access = await buildOrgAccess(identity.userId, org);
    if (!access.canManage) throw new Meteor.Error('forbidden', 'Manage permission required');
    return { users: await loadOrgMembers(orgId) };
  },

  async 'orgs.listUsers'({ orgId }) {
    const identity = await requireIdentity(this);
    if (!isValidId(orgId)) throw new Meteor.Error('not-found', 'Invalid orgId');
    const accessible = await getAccessibleOrgIds(identity.userId);
    if (!accessible.includes(orgId)) throw new Meteor.Error('forbidden', 'Not accessible');
    return { users: await loadOrgMembers(orgId) };
  },

  async 'orgs.searchUsers'({ orgId, q }) {
    const identity = await requireIdentity(this);
    if (!isValidId(orgId)) throw new Meteor.Error('not-found', 'Invalid orgId');
    const org = await rawDb().collection('organizations').findOne({ _id: new ObjectId(orgId) });
    if (!org) throw new Meteor.Error('not-found', 'Organization not found');
    const access = await buildOrgAccess(identity.userId, org);
    if (!access.canManage) throw new Meteor.Error('forbidden', 'Manage permission required');

    const query = (q ?? '').trim();
    const filter = query
      ? { $or: [
          { name: { $regex: query, $options: 'i' } },
          { username: { $regex: query, $options: 'i' } },
          { email: { $regex: query, $options: 'i' } },
        ] }
      : {};
    const users = await rawDb().collection('user')
      .find(filter, { projection: { _id: 1, name: 1, username: 1 } })
      .sort({ name: 1 })
      .limit(20)
      .toArray();
    return { users: users.map((u) => ({ id: u._id.toHexString(), name: u.name, username: u.username ?? null })) };
  },

  async 'orgs.setMemberRole'({ orgId, userId, role }) {
    const identity = await requireIdentity(this);
    if (!isValidId(orgId)) throw new Meteor.Error('not-found', 'Invalid orgId');
    if (!isValidId(userId)) throw new Meteor.Error('not-found', 'Invalid userId');
    if (!['owner', 'admin', 'member'].includes(role)) throw new Meteor.Error('bad-request', 'Invalid role');
    const db = rawDb();
    const [org, targetUser, membershipDocs] = await Promise.all([
      db.collection('organizations').findOne({ _id: new ObjectId(orgId) }),
      db.collection('user').findOne({ _id: new ObjectId(userId) }),
      db.collection('org_members').find({ orgId }).toArray(),
    ]);
    if (!org) throw new Meteor.Error('not-found', 'Organization not found');
    const access = await buildOrgAccess(identity.userId, org);
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
    if (!isValidId(orgId)) throw new Meteor.Error('not-found', 'Invalid orgId');
    if (!isValidId(userId)) throw new Meteor.Error('not-found', 'Invalid userId');
    const db = rawDb();
    const [org, targetUser, membershipDocs] = await Promise.all([
      db.collection('organizations').findOne({ _id: new ObjectId(orgId) }),
      db.collection('user').findOne({ _id: new ObjectId(userId) }),
      db.collection('org_members').find({ orgId }).toArray(),
    ]);
    if (!org) throw new Meteor.Error('not-found', 'Organization not found');
    const access = await buildOrgAccess(identity.userId, org);
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

  async 'orgs.updateMemberReportsTo'({ orgId, userId, reportsToUserId }) {
    const identity = await requireIdentity(this);
    if (!isValidId(orgId)) throw new Meteor.Error('not-found', 'Invalid orgId');
    if (!isValidId(userId)) throw new Meteor.Error('not-found', 'Invalid userId');
    const org = await rawDb().collection('organizations').findOne({ _id: new ObjectId(orgId) });
    if (!org) throw new Meteor.Error('not-found', 'Organization not found');
    const access = await buildOrgAccess(identity.userId, org);
    if (!access.canManage) throw new Meteor.Error('forbidden', 'Manage permission required');

    const targetMembership = await getOrgMembership(orgId, userId);
    if (!targetMembership) throw new Meteor.Error('not-member', 'Not an org member');

    if (reportsToUserId !== undefined && reportsToUserId !== null) {
      if (!isValidId(reportsToUserId)) throw new Meteor.Error('not-found', 'Reports-to user not found');
      if (reportsToUserId === userId) throw new Meteor.Error('bad-request', 'Cannot report to self');
      const rtMembership = await getOrgMembership(orgId, reportsToUserId);
      if (!rtMembership) throw new Meteor.Error('not-found', 'Reports-to user not in org');
    }

    await rawDb().collection('user').updateOne(
      { _id: new ObjectId(userId) },
      { $set: { reportsToUserId: reportsToUserId ?? null, updatedAt: new Date() } },
    );
    return { user: { id: userId, reportsToUserId: reportsToUserId ?? null } };
  },

  async 'orgs.updateReportsTo'({ userId, reportsToUserId }) {
    const identity = await requireIdentity(this);
    if (!isValidId(userId)) throw new Meteor.Error('not-found', 'Invalid userId');
    const defaultOrg = await requireDefaultOrgAdmin(identity.userId);
    const user = await rawDb().collection('user').findOne({ _id: new ObjectId(userId) });
    if (!user) throw new Meteor.Error('not-found', 'User not found');

    if (reportsToUserId !== undefined && reportsToUserId !== null) {
      if (!isValidId(reportsToUserId)) throw new Meteor.Error('not-found', 'Reports-to user not found');
      const rtUser = await rawDb().collection('user').findOne({ _id: new ObjectId(reportsToUserId) });
      if (!rtUser) throw new Meteor.Error('not-found', 'Reports-to user not found');
    }

    await rawDb().collection('user').updateOne(
      { _id: new ObjectId(userId) },
      { $set: { reportsToUserId: reportsToUserId ?? null, updatedAt: new Date() } },
    );
    return { user: { userId, reportsToUserId: reportsToUserId ?? null } };
  },

  // ── Default org admin endpoints (from users.ts) ───────────────────────────

  async 'orgs.adminGet'() {
    const identity = await requireIdentity(this);
    const defaultOrg = await requireDefaultOrgAdmin(identity.userId);
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
    const defaultOrg = await requireDefaultOrgAdmin(identity.userId);
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
    const defaultOrg = await requireDefaultOrgAdmin(identity.userId);
    const owners = defaultOrg.owners ?? [];
    const admins = defaultOrg.admins ?? [];
    const users = await rawDb().collection('user')
      .find({}, { projection: { name: 1, email: 1, username: 1, image: 1, reportsToUserId: 1 } })
      .sort({ name: 1, email: 1 })
      .limit(500)
      .toArray();
    return {
      users: users.map((u) => ({
        id: u._id.toHexString(),
        name: u.name,
        email: u.email,
        username: u.username ?? null,
        image: u.image ?? null,
        reportsToUserId: u.reportsToUserId ?? null,
        role: resolveDefaultOrgRole(owners, admins, u._id.toHexString()),
      })),
    };
  },

  async 'orgs.adminSetUserRole'({ userId, role }) {
    const identity = await requireIdentity(this);
    if (!isValidId(userId)) throw new Meteor.Error('not-found', 'Invalid userId');
    if (!['owner', 'admin', 'member'].includes(role)) throw new Meteor.Error('bad-request', 'Invalid role');
    const defaultOrg = await requireDefaultOrgAdmin(identity.userId);
    const db = rawDb();
    const targetUser = await db.collection('user').findOne({ _id: new ObjectId(userId) });
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
    await requireIdentity(this);
    const defaultOrg = await rawDb().collection('organizations').findOne({ slug: DEFAULT_ORG_KEY });
    if (!defaultOrg) throw new Meteor.Error('not-found', 'Default organization not found');
    return { organization: { id: defaultOrg._id.toHexString(), slug: defaultOrg.slug, name: defaultOrg.name } };
  },

  async 'orgs.publicListUsers'() {
    await requireIdentity(this);
    const defaultOrg = await rawDb().collection('organizations').findOne({ slug: DEFAULT_ORG_KEY });
    if (!defaultOrg) throw new Meteor.Error('not-found', 'Organization not found');
    const owners = defaultOrg.owners ?? [];
    const admins = defaultOrg.admins ?? [];
    const users = await rawDb().collection('user')
      .find({}, { projection: { name: 1, email: 1, username: 1, image: 1, reportsToUserId: 1 } })
      .sort({ name: 1, email: 1 })
      .limit(500)
      .toArray();
    return {
      users: users.map((u) => ({
        id: u._id.toHexString(),
        name: u.name,
        email: u.email,
        username: u.username ?? null,
        image: u.image ?? null,
        reportsToUserId: u.reportsToUserId ?? null,
        role: resolveDefaultOrgRole(owners, admins, u._id.toHexString()),
      })),
    };
  },
});
