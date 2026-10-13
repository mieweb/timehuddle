/**
 * Organizations — wormhole REST integration tests.
 *
 * Focus: orgs.removeMember, and that it agrees with the member list
 * (orgs.listMembers). Everyone the list shows can be removed, and a removed
 * member stays removed.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  DDPConnection,
  createUserAndGetJwt,
  wormhole,
  getDb,
  closeDb,
  purgeUser,
  ObjectId,
} from './helpers';
import { METEOR_URL } from './setup';

const OWNER = { name: 'Org Owner', email: 'wh-org-owner@test.dev', password: 'Password1!' };
const MEMBER = { name: 'Org Member', email: 'wh-org-member@test.dev', password: 'Password1!' };

const orgId = new ObjectId().toHexString();
const DEFAULT_ORG_SLUG = process.env.DEFAULT_ORG_KEY ?? 'default';

let ownerJwt: string;
let memberJwt: string;
let ownerId: string;
let memberId: string;

type ListedMember = { id: string; role: string };

async function listedMember(inOrgId = orgId): Promise<ListedMember | undefined> {
  const res = await wormhole<{ users: ListedMember[] }>('orgs.listMembers', { orgId: inOrgId }, ownerJwt);
  expect(res.ok).toBe(true);
  return res.result.users.find((u) => u.id === memberId);
}

function removeMember(inOrgId = orgId, userId = memberId) {
  return wormhole('orgs.removeMember', { orgId: inOrgId, userId }, ownerJwt);
}

async function addTeam(fields: { name: string; members: string[]; admins: string[]; isPersonal?: boolean }) {
  const db = await getDb();
  const _id = new ObjectId();
  await db.collection('teams').insertOne({
    _id,
    orgId,
    parentTeamId: null,
    code: `RM${_id.toHexString().slice(-6).toUpperCase()}`,
    isPersonal: false,
    createdAt: new Date(),
    ...fields,
  });
  return _id;
}

async function addMembership(userId: string, role: string) {
  const db = await getDb();
  const now = new Date();
  await db.collection('org_members').insertOne({
    _id: new ObjectId(),
    orgId,
    userId,
    role,
    auto: false,
    createdAt: now,
    updatedAt: now,
  });
}

beforeAll(async () => {
  await Promise.all([purgeUser(OWNER.email), purgeUser(MEMBER.email)]);
  const [owner, member] = await Promise.all([createUserAndGetJwt(OWNER), createUserAndGetJwt(MEMBER)]);
  ownerJwt = owner.jwt;
  memberJwt = member.jwt;
  ownerId = owner.userId;
  memberId = member.userId;

  const db = await getDb();
  const now = new Date();
  await db.collection('organizations').insertOne({
    _id: new ObjectId(orgId),
    name: 'Remove Member Org',
    slug: `remove-member-${orgId}`,
    owners: [ownerId],
    admins: [],
    settings: {},
    settingsLocks: {},
    createdAt: now,
    updatedAt: now,
  });
}, 30000);

afterAll(async () => {
  const db = await getDb();
  await db.collection('teams').deleteMany({ $or: [{ orgId }, { isPersonal: true, members: memberId }] });
  await db.collection('organizations').deleteOne({ _id: new ObjectId(orgId) });
  await Promise.all([purgeUser(OWNER.email), purgeUser(MEMBER.email)]);
  await closeDb();
});

beforeEach(async () => {
  const db = await getDb();
  await db.collection('teams').deleteMany({ orgId });
  await db.collection('org_members').deleteMany({ orgId });
  await db.collection('organizations').updateOne(
    { _id: new ObjectId(orgId) },
    { $set: { owners: [ownerId], admins: [] } },
  );
  await db.collection('users').updateOne({ _id: memberId as never }, { $unset: { removedFromOrgs: '' } });
  await addMembership(ownerId, 'owner');
});

describe('orgs.removeMember', () => {
  it('removes a member who is on a team, from the list and from the team', async () => {
    await addMembership(memberId, 'member');
    const teamId = await addTeam({ name: 'Crew', members: [ownerId, memberId], admins: [ownerId] });
    expect(await listedMember()).toBeDefined();

    const res = await removeMember();
    expect(res.ok).toBe(true);

    expect(await listedMember()).toBeUndefined();
    const team = await (await getDb()).collection('teams').findOne({ _id: teamId });
    expect(team!.members).toEqual([ownerId]);
  });

  it('removes a person who is listed only through a team', async () => {
    await addTeam({ name: 'Crew', members: [ownerId, memberId], admins: [ownerId] });
    expect((await listedMember())?.role).toBe('member');

    const res = await removeMember();
    expect(res.ok).toBe(true);
    expect(await listedMember()).toBeUndefined();
  });

  it('removes an admin outright instead of demoting them to member', async () => {
    await addMembership(memberId, 'admin');
    const db = await getDb();
    await db.collection('organizations').updateOne({ _id: new ObjectId(orgId) }, { $set: { admins: [memberId] } });
    await addTeam({ name: 'Crew', members: [ownerId, memberId], admins: [ownerId, memberId] });
    expect((await listedMember())?.role).toBe('admin');

    const res = await removeMember();
    expect(res.ok).toBe(true);
    expect(await listedMember()).toBeUndefined();
  });

  it('refuses to remove the last owner or admin', async () => {
    const res = await removeMember(orgId, ownerId);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/at least one owner or admin/i);

    const db = await getDb();
    expect(await db.collection('org_members').findOne({ orgId, userId: ownerId })).not.toBeNull();
  });

  it('refuses to leave a team with no admin, and names the team', async () => {
    await addMembership(memberId, 'member');
    const teamId = await addTeam({ name: 'Solo Crew', members: [ownerId, memberId], admins: [memberId] });

    const res = await removeMember();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/only admin of Solo Crew/);

    const db = await getDb();
    expect(await listedMember()).toBeDefined();
    expect((await db.collection('teams').findOne({ _id: teamId }))!.admins).toEqual([memberId]);
  });

  it('rejects a user the member list does not show', async () => {
    const res = await removeMember();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not an org member/i);
  });

  it('ignores a personal team: it neither lists its owner nor is touched by removal', async () => {
    const personalId = await addTeam({
      name: 'Personal',
      members: [memberId],
      admins: [memberId],
      isPersonal: true,
    });
    expect(await listedMember()).toBeUndefined();

    await addMembership(memberId, 'member');
    const res = await removeMember();
    expect(res.ok).toBe(true);
    expect(await listedMember()).toBeUndefined();

    const personal = await (await getDb()).collection('teams').findOne({ _id: personalId });
    expect(personal!.members).toEqual([memberId]);
  });
});

describe('a member removed from the default organization', () => {
  let defaultOrgId: string;
  let originalAutoJoin: { settings?: unknown; legacy?: unknown };

  async function signInAsMember() {
    const ddp = new DDPConnection(METEOR_URL.replace('http://', 'ws://') + '/websocket');
    await ddp.connect();
    try {
      await ddp.login(MEMBER.email, MEMBER.password);
    } finally {
      ddp.close();
    }
  }

  async function defaultMembership() {
    return (await getDb()).collection('org_members').findOne({ orgId: defaultOrgId, userId: memberId });
  }

  beforeAll(async () => {
    const db = await getDb();
    // Drop the fixture org's teams first — a personal team left there would be
    // found and returned as-is. Then: creates the default org if this database
    // has none yet, and gives the member the personal team every real user has
    // inside it.
    await db.collection('teams').deleteMany({ orgId });
    const ensured = await wormhole('teams.ensurePersonal', {}, memberJwt);
    expect(ensured.ok).toBe(true);

    const defaultOrg = await db.collection('organizations').findOne({ slug: DEFAULT_ORG_SLUG });
    defaultOrgId = defaultOrg!._id.toHexString();
    originalAutoJoin = { settings: defaultOrg!.settings?.allowAutoJoin, legacy: defaultOrg!.allowAutoJoin };
    await db.collection('organizations').updateOne(
      { _id: defaultOrg!._id },
      { $set: { 'settings.allowAutoJoin': true, allowAutoJoin: true } },
    );
  });

  afterAll(async () => {
    const db = await getDb();
    const restore: { $set: Record<string, unknown>; $unset: Record<string, ''> } = { $set: {}, $unset: {} };
    if (originalAutoJoin.settings === undefined) restore.$unset['settings.allowAutoJoin'] = '';
    else restore.$set['settings.allowAutoJoin'] = originalAutoJoin.settings;
    if (originalAutoJoin.legacy === undefined) restore.$unset.allowAutoJoin = '';
    else restore.$set.allowAutoJoin = originalAutoJoin.legacy;
    const update = Object.fromEntries(Object.entries(restore).filter(([, v]) => Object.keys(v).length > 0));
    await db.collection('organizations').updateOne({ _id: new ObjectId(defaultOrgId) }, update);
    await db.collection('org_members').deleteMany({ orgId: defaultOrgId, userId: { $in: [ownerId, memberId] } });
  });

  beforeEach(async () => {
    const db = await getDb();
    const now = new Date();
    await db.collection('org_members').deleteMany({ userId: { $in: [ownerId, memberId] } });
    await db.collection('org_members').insertOne({
      _id: new ObjectId(),
      orgId: defaultOrgId,
      userId: ownerId,
      role: 'admin',
      auto: false,
      createdAt: now,
      updatedAt: now,
    });
  });

  it('is auto-joined at sign-in when they simply have no membership (control)', async () => {
    await signInAsMember();
    await expect.poll(defaultMembership, { timeout: 5000 }).not.toBeNull();
  });

  it('is not re-added at their next sign-in', async () => {
    await signInAsMember();
    await expect.poll(defaultMembership, { timeout: 5000 }).not.toBeNull();

    const res = await removeMember(defaultOrgId);
    expect(res.ok).toBe(true);
    expect(await listedMember(defaultOrgId)).toBeUndefined();

    await signInAsMember();
    // The auto-join runs after the login call returns, so give it time to (not) happen.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(await defaultMembership()).toBeNull();
    expect(await listedMember(defaultOrgId)).toBeUndefined();
  });
});
