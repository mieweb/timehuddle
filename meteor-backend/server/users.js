import { Meteor } from 'meteor/meteor';
import { MongoInternals } from 'meteor/mongo';
import { Teams, rawDb, isValidId } from './collections';
import { requireIdentity } from './auth-bridge';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

const BLOCKED_USERNAMES = new Set([
  'admin', 'administrator', 'api', 'auth', 'billing', 'bot', 'dashboard',
  'false', 'help', 'inbox', 'me', 'null', 'root', 'settings', 'signup',
  'support', 'system', 'team', 'teams', 'timehuddle', 'true', 'undefined',
  'user', 'users', 'www',
]);
const USERNAME_RE = /^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/;

function validateUsernameFormat(username) {
  if (username.length < 3) return 'too-short';
  if (username.length > 30) return 'too-long';
  if (!USERNAME_RE.test(username)) return 'invalid-chars';
  if (BLOCKED_USERNAMES.has(username)) return 'blocked';
  return null;
}

async function resolveReportsTo(user) {
  if (!user?.reportsToUserId) return null;
  if (!isValidId(user.reportsToUserId)) return null;
  const rt = await rawDb().collection('user').findOne({ _id: new ObjectId(user.reportsToUserId) });
  if (!rt) return null;
  return { id: rt._id.toHexString(), name: rt.name, username: rt.username ?? null };
}

async function resolveTeamMemberships(userId) {
  const teamDocs = await Teams.rawCollection()
    .find({ members: userId, isPersonal: { $ne: true } })
    .toArray();
  return teamDocs
    .map((t) => ({
      id: t._id.toHexString ? t._id.toHexString() : String(t._id),
      name: t.name,
      role: t.admins.includes(userId) ? 'admin' : 'member',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function toPublicUser(u, profileMap) {
  if (!u) return null;
  const userId = u._id.toHexString ? u._id.toHexString() : String(u._id);
  const profile = profileMap
    ? profileMap.get(userId)
    : await rawDb().collection('profiles').findOne({ userId, app: 'timeharbor' });
  return {
    id: userId,
    name: u.name,
    username: u.username ?? null,
    image: profile?.avatarUrl ?? u.image ?? null,
    backgroundUrl: profile?.backgroundUrl ?? null,
    bio: u.bio ?? '',
    website: u.website ?? '',
    reportsTo: await resolveReportsTo(u),
    teamMemberships: await resolveTeamMemberships(userId),
  };
}

Meteor.methods({
  async 'users.get'({ userId: targetUserId }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(targetUserId)) throw new Meteor.Error('not-found', 'Invalid user id');
    const user = await rawDb().collection('user').findOne({ _id: new ObjectId(targetUserId) });
    if (!user) throw new Meteor.Error('not-found', 'User not found');

    const sharedTeamDocs = userId !== targetUserId
      ? await Teams.rawCollection().find({
          members: { $all: [userId, targetUserId] },
          isPersonal: { $ne: true },
        }).toArray()
      : [];
    const sharedTeams = sharedTeamDocs.map((t) => ({
      id: t._id.toHexString ? t._id.toHexString() : String(t._id),
      name: t.name,
      isAdmin: t.admins.includes(userId),
    }));

    return { user: { ...(await toPublicUser(user)), sharedTeams } };
  },

  async 'users.getByUsername'({ username }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (typeof username !== 'string' || !username.trim()) {
      throw new Meteor.Error('bad-request', 'username is required');
    }
    const user = await rawDb().collection('user').findOne({ username: username.toLowerCase() });
    if (!user) throw new Meteor.Error('not-found', 'User not found');

    const targetId = user._id.toHexString();
    const sharedTeamDocs = userId !== targetId
      ? await Teams.rawCollection().find({
          members: { $all: [userId, targetId] },
          isPersonal: { $ne: true },
        }).toArray()
      : [];
    const sharedTeams = sharedTeamDocs.map((t) => ({
      id: t._id.toHexString ? t._id.toHexString() : String(t._id),
      name: t.name,
      isAdmin: t.admins.includes(userId),
    }));

    return { user: { ...(await toPublicUser(user)), sharedTeams } };
  },

  async 'users.batchGet'({ ids }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!ids || !Array.isArray(ids)) return { users: [] };
    const validIds = ids.slice(0, 200).filter(isValidId).map((id) => new ObjectId(id));
    if (validIds.length === 0) return { users: [] };

    const users = await rawDb().collection('user').find({ _id: { $in: validIds } }).toArray();
    const userIds = users.map((u) => u._id.toHexString());
    const profiles = await rawDb()
      .collection('profiles')
      .find({ userId: { $in: userIds }, app: 'timeharbor' })
      .toArray();
    const profileMap = new Map(profiles.map((p) => [p.userId, p]));

    return { users: await Promise.all(users.map((u) => toPublicUser(u, profileMap))) };
  },

  async 'users.updateProfile'({ name, bio, website, reportsToUserId }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;

    if (reportsToUserId !== undefined) {
      if (reportsToUserId === userId) {
        throw new Meteor.Error('bad-request', 'Cannot report to yourself');
      }
      if (reportsToUserId !== null) {
        if (!isValidId(reportsToUserId)) throw new Meteor.Error('bad-request', 'Invalid reportsToUserId');
        const rtUser = await rawDb().collection('user').findOne({ _id: new ObjectId(reportsToUserId) });
        if (!rtUser) throw new Meteor.Error('not-found', 'Reports-to user not found');
        const sharedTeam = await Teams.rawCollection().findOne({
          members: { $all: [userId, reportsToUserId] },
          isPersonal: { $ne: true },
        });
        if (!sharedTeam) throw new Meteor.Error('forbidden', 'Must share a non-personal team');
      }
    }

    const $set = { updatedAt: new Date() };
    if (name !== undefined) $set.name = name;
    if (bio !== undefined) $set.bio = bio;
    if (website !== undefined) $set.website = website;
    if (reportsToUserId !== undefined) $set.reportsToUserId = reportsToUserId;

    await rawDb().collection('user').updateOne({ _id: new ObjectId(userId) }, { $set });
    const updated = await rawDb().collection('user').findOne({ _id: new ObjectId(userId) });
    return { user: await toPublicUser(updated) };
  },

  async 'users.checkUsername'({ username }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (typeof username !== 'string') return { available: false, reason: 'invalid-chars' };
    const normalized = username.trim().toLowerCase();
    const formatError = validateUsernameFormat(normalized);
    if (formatError) return { available: false, reason: formatError };
    const existing = await rawDb().collection('user').findOne({ username: normalized });
    if (existing) return { available: false, reason: 'taken' };
    return { available: true };
  },

  async 'users.claimUsername'({ username }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (typeof username !== 'string') throw new Meteor.Error('bad-request', 'username is required');
    const normalized = username.trim().toLowerCase();
    const formatError = validateUsernameFormat(normalized);
    if (formatError) throw new Meteor.Error('bad-request', formatError);

    const user = await rawDb().collection('user').findOne({ _id: new ObjectId(userId) });
    if (user?.username) throw new Meteor.Error('already-claimed', 'Username already set');

    try {
      await rawDb().collection('user').updateOne(
        { _id: new ObjectId(userId), username: { $eq: null } },
        { $set: { username: normalized, updatedAt: new Date() } },
      );
    } catch (err) {
      if (err?.code === 11000) throw new Meteor.Error('taken', 'Username already taken');
      throw err;
    }

    return { username: normalized };
  },
});
