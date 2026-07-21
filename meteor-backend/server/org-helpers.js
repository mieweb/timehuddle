import { Meteor } from 'meteor/meteor';
import { MongoInternals } from 'meteor/mongo';
import { rawDb, isValidId } from './collections';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

const DEFAULT_ORG_KEY = process.env.DEFAULT_ORG_KEY || 'default';
const DEFAULT_ORG_NAME = process.env.DEFAULT_ORG_NAME || 'Default Organization';
const DEFAULT_ENTERPRISE_SLUG = process.env.DEFAULT_ENTERPRISE_SLUG || `${DEFAULT_ORG_KEY}-enterprise`;
const DEFAULT_ENTERPRISE_NAME = process.env.DEFAULT_ENTERPRISE_NAME || 'Default Enterprise';

const ROLE_RANK = { member: 1, admin: 2, owner: 3 };

const DUPLICATE_KEY_ERROR_CODE = 11000;

// Upsert-by-slug relies on these unique indexes to make first-writer-wins
// atomic across concurrent requests (e.g. two browsers hitting takeOwnership
// on a fresh install at the same time). Without them, concurrent findOne+
// insertOne calls can each observe "not found" and create duplicate default
// enterprise/organization documents.
Meteor.startup(async () => {
  try {
    await rawDb().collection('enterprises').createIndex(
      { slug: 1 },
      { name: 'unique_enterprise_slug', unique: true },
    );
    await rawDb().collection('organizations').createIndex(
      { slug: 1 },
      { name: 'unique_organization_slug', unique: true },
    );
  } catch (error) {
    console.error('[org-helpers] failed to create default org/enterprise indexes:', error);
  }
});

async function ensureDefaultEnterprise() {
  const db = rawDb();
  const now = new Date();

  try {
    await db.collection('enterprises').updateOne(
      { slug: DEFAULT_ENTERPRISE_SLUG },
      {
        $setOnInsert: {
          _id: new ObjectId(),
          name: DEFAULT_ENTERPRISE_NAME,
          slug: DEFAULT_ENTERPRISE_SLUG,
          owners: [],
          admins: [],
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
  } catch (error) {
    // Lost the race to another concurrent upsert on the same unique slug — fine, fall through to read it.
    if (error?.code !== DUPLICATE_KEY_ERROR_CODE) throw error;
  }

  return db.collection('enterprises').findOne({ slug: DEFAULT_ENTERPRISE_SLUG });
}

export async function ensureDefaultOrganization() {
  const db = rawDb();
  const defaultEnterprise = await ensureDefaultEnterprise();
  const now = new Date();

  try {
    await db.collection('organizations').updateOne(
      { slug: DEFAULT_ORG_KEY },
      {
        $setOnInsert: {
          _id: new ObjectId(),
          enterpriseId: defaultEnterprise._id.toHexString(),
          slug: DEFAULT_ORG_KEY,
          name: DEFAULT_ORG_NAME,
          owners: [],
          admins: [],
          allowAutoJoin: true,
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
  } catch (error) {
    if (error?.code !== DUPLICATE_KEY_ERROR_CODE) throw error;
  }

  const existing = await db.collection('organizations').findOne({ slug: DEFAULT_ORG_KEY });
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

/**
 * True if `userId` has team-admin authority on `team` — either because they
 * are listed in `team.admins`, or because they own the organization the team
 * belongs to. Org owners get full team-admin authority on every team in
 * their org (rename, delete, invite, remove member, set role/password,
 * approve/decline join requests, manage invitations).
 */
export async function isTeamAdminOrOrgOwner(team, userId) {
  if (team.admins.includes(userId)) return true;
  if (!team.orgId || !isValidId(team.orgId)) return false;
  const org = await rawDb().collection('organizations').findOne({ _id: new ObjectId(team.orgId) });
  return !!org?.owners?.includes(userId);
}

