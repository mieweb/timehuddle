import { MongoInternals } from 'meteor/mongo';
import { rawDb, isValidId } from './collections';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

const DEFAULT_ORG_KEY = process.env.DEFAULT_ORG_KEY || 'default';
const DEFAULT_ORG_NAME = process.env.DEFAULT_ORG_NAME || 'Default Organization';
const DEFAULT_ENTERPRISE_SLUG = process.env.DEFAULT_ENTERPRISE_SLUG || `${DEFAULT_ORG_KEY}-enterprise`;
const DEFAULT_ENTERPRISE_NAME = process.env.DEFAULT_ENTERPRISE_NAME || 'Default Enterprise';

const ROLE_RANK = { member: 1, admin: 2, owner: 3 };

async function ensureDefaultEnterprise() {
  const db = rawDb();
  const existing = await db.collection('enterprises').findOne({ slug: DEFAULT_ENTERPRISE_SLUG });
  if (existing) return existing;

  const now = new Date();
  const enterprise = {
    _id: new ObjectId(),
    name: DEFAULT_ENTERPRISE_NAME,
    slug: DEFAULT_ENTERPRISE_SLUG,
    owners: [],
    admins: [],
    createdAt: now,
    updatedAt: now,
  };
  await db.collection('enterprises').insertOne(enterprise);
  return enterprise;
}

export async function ensureDefaultOrganization() {
  const db = rawDb();
  const defaultEnterprise = await ensureDefaultEnterprise();
  const existing = await db.collection('organizations').findOne({ slug: DEFAULT_ORG_KEY });

  if (existing) {
    const updates = {};
    if (!existing.enterpriseId) updates.enterpriseId = defaultEnterprise._id.toHexString();
    if (existing.allowAutoJoin === undefined) updates.allowAutoJoin = true;
    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date();
      await db.collection('organizations').updateOne({ _id: existing._id }, { $set: updates });
      return (await db.collection('organizations').findOne({ _id: existing._id })) ?? existing;
    }
    return existing;
  }

  const now = new Date();
  const org = {
    _id: new ObjectId(),
    enterpriseId: defaultEnterprise._id.toHexString(),
    slug: DEFAULT_ORG_KEY,
    name: DEFAULT_ORG_NAME,
    owners: [],
    admins: [],
    allowAutoJoin: true,
    createdAt: now,
    updatedAt: now,
  };
  await db.collection('organizations').insertOne(org);
  return org;
}

async function syncLegacyRoleArrays(orgId, userId, role) {
  if (!isValidId(orgId)) return;
  const db = rawDb();
  const updatedAt = new Date();

  if (role === 'owner') {
    await db.collection('organizations').updateOne(
      { _id: new ObjectId(orgId) },
      { $addToSet: { owners: userId }, $pull: { admins: userId }, $set: { updatedAt } },
    );
    return;
  }
  if (role === 'admin') {
    await db.collection('organizations').updateOne(
      { _id: new ObjectId(orgId) },
      { $pull: { owners: userId }, $addToSet: { admins: userId }, $set: { updatedAt } },
    );
    return;
  }
  await db.collection('organizations').updateOne(
    { _id: new ObjectId(orgId) },
    { $pull: { owners: userId, admins: userId }, $set: { updatedAt } },
  );
}

export async function addOrgMember(orgId, userId, role = 'member', auto = false) {
  if (!isValidId(orgId)) return 'not-found';
  const db = rawDb();
  const org = await db.collection('organizations').findOne({ _id: new ObjectId(orgId) });
  if (!org) return 'not-found';

  const existing = await db.collection('org_members').findOne({ orgId, userId });
  const nextRole = existing
    ? (ROLE_RANK[role] > ROLE_RANK[existing.role] ? role : existing.role)
    : role;
  const nextAuto = existing
    ? (existing.auto && auto && existing.role === nextRole)
    : auto;

  if (existing) {
    if (existing.role !== nextRole || existing.auto !== nextAuto) {
      await db.collection('org_members').updateOne(
        { _id: existing._id },
        { $set: { role: nextRole, auto: nextAuto, updatedAt: new Date() } },
      );
    }
  } else {
    await db.collection('org_members').insertOne({
      _id: new ObjectId(),
      orgId,
      userId,
      role: nextRole,
      auto: nextAuto,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  await syncLegacyRoleArrays(orgId, userId, nextRole);
  return { orgId, userId, role: nextRole, auto: nextAuto };
}

export async function getAccessibleOrgIds(userId) {
  const db = rawDb();
  const memberships = await db.collection('org_members').find({ userId }).toArray();
  return memberships.map((m) => m.orgId);
}
