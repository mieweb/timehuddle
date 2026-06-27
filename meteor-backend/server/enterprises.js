import { Meteor } from 'meteor/meteor';
import { MongoInternals } from 'meteor/mongo';
import { rawDb, isValidId } from './collections';
import { requireIdentity } from './auth-bridge';
import { ensureDefaultOrganization } from './org-helpers';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

function slugify(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-').slice(0, 64);
}

async function resolveMembers(owners, admins) {
  const allIds = [...new Set([...owners, ...admins])];
  if (allIds.length === 0) return [];
  const validIds = allIds.filter(isValidId).map((id) => new ObjectId(id));
  const users = await rawDb().collection('user')
    .find({ _id: { $in: validIds } }, { projection: { _id: 1, name: 1, username: 1 } })
    .toArray();
  const byId = new Map(users.map((u) => [u._id.toHexString(), u]));
  return allIds.map((id) => {
    const u = byId.get(id);
    return {
      id,
      name: u?.name ?? id,
      username: u?.username ?? null,
      role: owners.includes(id) ? 'owner' : 'admin',
    };
  });
}

Meteor.methods({
  async 'enterprises.list'() {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    const enterprises = await rawDb().collection('enterprises')
      .find({ $or: [{ owners: userId }, { admins: userId }] })
      .sort({ name: 1 })
      .toArray();
    return {
      enterprises: enterprises.map((e) => ({
        id: e._id.toHexString(),
        name: e.name,
        slug: e.slug,
        role: (e.owners ?? []).includes(userId) ? 'owner' : 'admin',
      })),
    };
  },

  async 'enterprises.create'({ name, slug: inputSlug }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new Meteor.Error('bad-request', 'name is required');
    const slug = slugify(inputSlug ?? trimmed) || `enterprise-${Date.now()}`;

    const db = rawDb();
    const existing = await db.collection('enterprises').findOne({ slug });
    if (existing) throw new Meteor.Error('conflict', 'Slug already taken');

    const now = new Date();
    const enterprise = {
      _id: new ObjectId(),
      name: trimmed,
      slug,
      owners: [userId],
      admins: [],
      createdAt: now,
      updatedAt: now,
    };
    await db.collection('enterprises').insertOne(enterprise);

    return {
      enterprise: {
        id: enterprise._id.toHexString(),
        name: trimmed,
        slug,
        role: 'owner',
        owners: enterprise.owners,
        admins: enterprise.admins,
        members: [{ id: userId, name: 'User', username: null, role: 'owner' }],
      },
    };
  },

  async 'enterprises.get'({ enterpriseId }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(enterpriseId)) throw new Meteor.Error('not-found', 'Invalid enterpriseId');
    const enterprise = await rawDb().collection('enterprises').findOne({ _id: new ObjectId(enterpriseId) });
    if (!enterprise) throw new Meteor.Error('not-found', 'Enterprise not found');
    const owners = enterprise.owners ?? [];
    const admins = enterprise.admins ?? [];
    const role = owners.includes(userId) ? 'owner' : admins.includes(userId) ? 'admin' : null;
    if (!role) throw new Meteor.Error('forbidden', 'Not an enterprise owner or admin');
    const members = await resolveMembers(owners, admins);
    return {
      enterprise: {
        id: enterprise._id.toHexString(),
        name: enterprise.name,
        slug: enterprise.slug,
        role,
        owners,
        admins,
        members,
      },
    };
  },

  async 'enterprises.updateName'({ enterpriseId, name }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(enterpriseId)) throw new Meteor.Error('not-found', 'Invalid enterpriseId');
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new Meteor.Error('bad-request', 'name is required');
    const enterprise = await rawDb().collection('enterprises').findOne({ _id: new ObjectId(enterpriseId) });
    if (!enterprise) throw new Meteor.Error('not-found', 'Enterprise not found');
    const owners = enterprise.owners ?? [];
    const admins = enterprise.admins ?? [];
    const role = owners.includes(userId) ? 'owner' : admins.includes(userId) ? 'admin' : null;
    if (!role) throw new Meteor.Error('forbidden', 'Not an enterprise owner or admin');

    await rawDb().collection('enterprises').updateOne(
      { _id: enterprise._id },
      { $set: { name: trimmed, updatedAt: new Date() } },
    );
    const members = await resolveMembers(owners, admins);
    return {
      enterprise: {
        id: enterprise._id.toHexString(),
        name: trimmed,
        slug: enterprise.slug,
        role,
        owners,
        admins,
        members,
      },
    };
  },

  async 'enterprises.searchUsers'({ enterpriseId, q }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(enterpriseId)) throw new Meteor.Error('not-found', 'Invalid enterpriseId');
    const enterprise = await rawDb().collection('enterprises').findOne({ _id: new ObjectId(enterpriseId) });
    if (!enterprise) throw new Meteor.Error('not-found', 'Enterprise not found');
    const owners = enterprise.owners ?? [];
    const admins = enterprise.admins ?? [];
    if (!owners.includes(userId) && !admins.includes(userId)) {
      throw new Meteor.Error('forbidden', 'Not an enterprise owner or admin');
    }

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

  async 'enterprises.setMemberRole'({ enterpriseId, userId: targetUserId, role }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(enterpriseId)) throw new Meteor.Error('not-found', 'Invalid enterpriseId');
    if (role !== 'owner' && role !== 'admin') throw new Meteor.Error('bad-request', 'role must be owner or admin');
    const enterprise = await rawDb().collection('enterprises').findOne({ _id: new ObjectId(enterpriseId) });
    if (!enterprise) throw new Meteor.Error('not-found', 'Enterprise not found');
    if (!(enterprise.owners ?? []).includes(userId)) {
      throw new Meteor.Error('forbidden', 'Owner access required');
    }

    const owners = new Set(enterprise.owners ?? []);
    const admins = new Set(enterprise.admins ?? []);
    owners.delete(targetUserId);
    admins.delete(targetUserId);
    if (role === 'owner') owners.add(targetUserId);
    if (role === 'admin') admins.add(targetUserId);

    await rawDb().collection('enterprises').updateOne(
      { _id: enterprise._id },
      { $set: { owners: Array.from(owners), admins: Array.from(admins), updatedAt: new Date() } },
    );
    return { user: { userId: targetUserId, role } };
  },

  async 'enterprises.removeMember'({ enterpriseId, userId: targetUserId }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(enterpriseId)) throw new Meteor.Error('not-found', 'Invalid enterpriseId');
    const enterprise = await rawDb().collection('enterprises').findOne({ _id: new ObjectId(enterpriseId) });
    if (!enterprise) throw new Meteor.Error('not-found', 'Enterprise not found');
    if (!(enterprise.owners ?? []).includes(userId)) {
      throw new Meteor.Error('forbidden', 'Owner access required');
    }

    const owners = new Set(enterprise.owners ?? []);
    const admins = new Set(enterprise.admins ?? []);
    if (owners.has(targetUserId) && owners.size === 1 && admins.size === 0) {
      throw new Meteor.Error('last-owner', 'Cannot remove the last owner');
    }
    owners.delete(targetUserId);
    admins.delete(targetUserId);

    await rawDb().collection('enterprises').updateOne(
      { _id: enterprise._id },
      { $set: { owners: Array.from(owners), admins: Array.from(admins), updatedAt: new Date() } },
    );
    return { userId: targetUserId };
  },

  async 'enterprises.takeOwnership'() {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    const db = rawDb();
    const now = new Date();

    // Check if already completed
    const installation = await db.collection('installations').findOne({ _id: 'Installation' });
    if (installation?.completedAt) {
      throw new Meteor.Error('conflict', 'Owner already exists or install is already complete');
    }

    // Ensure default org + enterprise exist
    const defaultOrg = await ensureDefaultOrganization();
    const defaultEnterpriseId = defaultOrg.enterpriseId;
    if (!defaultEnterpriseId) throw new Meteor.Error('not-found', 'No default enterprise found');

    // Set user as enterprise owner (atomic, first-writer wins)
    const enterpriseResult = await db.collection('enterprises').updateOne(
      { _id: new ObjectId(defaultEnterpriseId), 'owners.0': { $exists: false } },
      { $set: { owners: [userId], admins: [], updatedAt: now } }
    );
    if (enterpriseResult.matchedCount === 0) {
      throw new Meteor.Error('conflict', 'Owner already exists or install is already complete');
    }

    // Attach all orgs missing an enterprise
    await db.collection('organizations').updateMany(
      { $or: [{ enterpriseId: { $exists: false } }, { enterpriseId: null }, { enterpriseId: '' }] },
      { $set: { enterpriseId: defaultEnterpriseId, updatedAt: now } }
    );

    // Set user as org owner if no owners yet
    const orgDoc = await db.collection('organizations').findOne({ _id: new ObjectId(defaultOrg._id.toHexString()) });
    if (!orgDoc?.owners || orgDoc.owners.length === 0) {
      await db.collection('organizations').updateOne(
        { _id: new ObjectId(defaultOrg._id.toHexString()) },
        { $set: { owners: [userId], admins: [], updatedAt: now } }
      );
    }

    // Upsert org membership
    await db.collection('org_members').updateOne(
      { orgId: defaultOrg._id.toHexString(), userId },
      {
        $setOnInsert: { _id: new ObjectId(), createdAt: now },
        $set: { orgId: defaultOrg._id.toHexString(), userId, role: 'owner', auto: false, updatedAt: now },
      },
      { upsert: true }
    );

    // Mark installation completed
    await db.collection('installations').updateOne(
      { _id: 'Installation' },
      {
        $setOnInsert: { _id: 'Installation', createdAt: now },
        $set: { completedAt: now, completedByUserId: userId, updatedAt: now },
      },
      { upsert: true }
    );

    return { role: 'owner' };
  },

  async 'enterprise.installStatus'() {
    // No auth required — called before login to check setup state
    const db = rawDb();
    const enterprise = await db.collection('enterprises').findOne({});
    const hasOwner = enterprise
      ? ((enterprise.owners ?? []).length > 0 || (enterprise.admins ?? []).length > 0)
      : false;
    return { hasOwner, installCompleted: hasOwner };
  },
});
