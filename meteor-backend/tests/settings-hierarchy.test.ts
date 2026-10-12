/**
 * Hierarchical settings write APIs — wormhole REST integration tests, #607.
 *
 * Fixture: enterprise > org > team, with an enterprise admin, an org owner, a
 * team admin and a plain team member.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createUserAndGetJwt, wormhole, getDb, closeDb, purgeUser, ObjectId } from './helpers';

const USERS = {
  entAdmin: { name: 'Set Ent Admin', email: 'wh-set-ent-admin@test.dev', password: 'Password1!' },
  orgOwner: { name: 'Set Org Owner', email: 'wh-set-org-owner@test.dev', password: 'Password1!' },
  teamAdmin: { name: 'Set Team Admin', email: 'wh-set-team-admin@test.dev', password: 'Password1!' },
  member: { name: 'Set Member', email: 'wh-set-member@test.dev', password: 'Password1!' },
};

type Settings = { requirePlanForClock: boolean; autoAcceptJoins: boolean };
type TeamsList = { teams: Array<{ id: string; settings: Settings }> };

const jwts = {} as Record<keyof typeof USERS, string>;
const ids = {} as Record<keyof typeof USERS, string>;
const enterpriseId = new ObjectId();
const orgId = new ObjectId();
const teamId = new ObjectId();

async function teamSettings(): Promise<Settings> {
  const res = await wormhole<TeamsList>('teams.list', {}, jwts.teamAdmin);
  return res.result.teams.find((t) => t.id === teamId.toHexString())!.settings;
}

beforeAll(async () => {
  const emails = Object.values(USERS).map((u) => u.email);
  await Promise.all(emails.map((email) => purgeUser(email)));
  for (const key of Object.keys(USERS) as Array<keyof typeof USERS>) {
    jwts[key] = (await createUserAndGetJwt(USERS[key])).jwt;
  }

  const db = await getDb();
  for (const key of Object.keys(USERS) as Array<keyof typeof USERS>) {
    ids[key] = String((await db.collection('users').findOne({ 'emails.address': USERS[key].email }))!._id);
  }

  const now = new Date();
  await db.collection('enterprises').insertOne({
    _id: enterpriseId,
    name: 'Settings Enterprise',
    slug: `settings-ent-${enterpriseId.toHexString()}`,
    owners: [ids.entAdmin],
    admins: [],
    settings: {},
    settingsLocks: {},
    createdAt: now,
    updatedAt: now,
  });
  await db.collection('organizations').insertOne({
    _id: orgId,
    enterpriseId: enterpriseId.toHexString(),
    name: 'Settings Org',
    slug: `settings-org-${orgId.toHexString()}`,
    owners: [ids.orgOwner],
    admins: [],
    settings: {},
    settingsLocks: {},
    createdAt: now,
    updatedAt: now,
  });
  await db.collection('org_members').insertOne({
    _id: new ObjectId(),
    orgId: orgId.toHexString(),
    userId: ids.orgOwner,
    role: 'owner',
    auto: false,
    createdAt: now,
    updatedAt: now,
  });
  await db.collection('teams').insertOne({
    _id: teamId,
    orgId: orgId.toHexString(),
    name: 'Settings Team',
    members: [ids.teamAdmin, ids.member],
    admins: [ids.teamAdmin],
    code: 'WHSETT01',
    isPersonal: false,
    createdAt: now,
  });
}, 60000);

afterAll(async () => {
  const db = await getDb();
  await db.collection('teams').deleteMany({ _id: teamId });
  await db.collection('organizations').deleteMany({ _id: orgId });
  await db.collection('enterprises').deleteMany({ _id: enterpriseId });
  await db.collection('org_members').deleteMany({ orgId: orgId.toHexString() });
  await Promise.all(Object.values(USERS).map((u) => purgeUser(u.email)));
  await closeDb();
});

beforeEach(async () => {
  const db = await getDb();
  await db.collection('enterprises').updateOne(
    { _id: enterpriseId },
    { $set: { settings: {}, settingsLocks: {} } },
  );
  await db.collection('organizations').updateOne(
    { _id: orgId },
    { $set: { settings: {}, settingsLocks: {} } },
  );
  await db.collection('teams').updateOne({ _id: teamId }, { $unset: { settings: '' } });
});

describe('org defaults', () => {
  it('a team with no value inherits the org default', async () => {
    const res = await wormhole(
      'orgs.updateSettings',
      { orgId: orgId.toHexString(), settings: { requirePlanForClock: false } },
      jwts.orgOwner,
    );
    expect(res.ok).toBe(true);
    expect((await teamSettings()).requirePlanForClock).toBe(false);
  });

  it('an org inherits the enterprise default, and so does its team', async () => {
    const res = await wormhole(
      'enterprises.updateSettings',
      { enterpriseId: enterpriseId.toHexString(), settings: { autoAcceptJoins: true } },
      jwts.entAdmin,
    );
    expect(res.ok).toBe(true);
    expect((await teamSettings()).autoAcceptJoins).toBe(true);

    const org = await wormhole<{ organization: { allowAutoJoin: boolean } }>(
      'orgs.get',
      { orgId: orgId.toHexString() },
      jwts.orgOwner,
    );
    expect(org.result.organization.allowAutoJoin).toBe(true);
  });

  it('the old allowAutoJoin call still works', async () => {
    const res = await wormhole<{ organization: { allowAutoJoin: boolean; settings: object } }>(
      'orgs.updateSettings',
      { orgId: orgId.toHexString(), allowAutoJoin: false },
      jwts.orgOwner,
    );
    expect(res.ok).toBe(true);
    expect(res.result.organization.allowAutoJoin).toBe(false);
    expect(res.result.organization.settings).toEqual({ allowAutoJoin: false });
  });
});

describe('locks', () => {
  it('an org lock blocks a team write, and the value stays', async () => {
    const lock = await wormhole(
      'orgs.updateSettings',
      {
        orgId: orgId.toHexString(),
        settings: { autoAcceptJoins: false },
        locks: { autoAcceptJoins: true },
      },
      jwts.orgOwner,
    );
    expect(lock.ok).toBe(true);

    const write = await wormhole(
      'teams.updateSettings',
      { teamId: teamId.toHexString(), autoAcceptJoins: true },
      jwts.teamAdmin,
    );
    expect(write.ok).toBe(false);
    expect(write.error).toMatch(/locked by the organization/);
    expect((await teamSettings()).autoAcceptJoins).toBe(false);
  });

  it('an enterprise lock blocks an org write', async () => {
    await wormhole(
      'enterprises.updateSettings',
      {
        enterpriseId: enterpriseId.toHexString(),
        settings: { requirePlanForClock: true },
        locks: { requirePlanForClock: true },
      },
      jwts.entAdmin,
    );

    const write = await wormhole(
      'orgs.updateSettings',
      { orgId: orgId.toHexString(), settings: { requirePlanForClock: false } },
      jwts.orgOwner,
    );
    expect(write.ok).toBe(false);
    expect(write.error).toMatch(/locked by the enterprise/);
  });

  it('refuses to lock a setting that has no value', async () => {
    const res = await wormhole(
      'orgs.updateSettings',
      { orgId: orgId.toHexString(), locks: { autoAcceptJoins: true } },
      jwts.orgOwner,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/needs a value/);
  });
});

describe('reset to inherited', () => {
  it('null removes the team value so the org default shows again', async () => {
    await wormhole(
      'orgs.updateSettings',
      { orgId: orgId.toHexString(), settings: { requirePlanForClock: false } },
      jwts.orgOwner,
    );
    await wormhole(
      'teams.updateSettings',
      { teamId: teamId.toHexString(), requirePlanForClock: true },
      jwts.teamAdmin,
    );
    expect((await teamSettings()).requirePlanForClock).toBe(true);

    const reset = await wormhole(
      'teams.updateSettings',
      { teamId: teamId.toHexString(), requirePlanForClock: null },
      jwts.teamAdmin,
    );
    expect(reset.ok).toBe(true);
    expect((await teamSettings()).requirePlanForClock).toBe(false);

    const db = await getDb();
    const team = await db.collection('teams').findOne({ _id: teamId });
    expect(team?.settings).not.toHaveProperty('requirePlanForClock');
  });
});

describe('permissions', () => {
  it('a plain member cannot change org settings', async () => {
    const res = await wormhole(
      'orgs.updateSettings',
      { orgId: orgId.toHexString(), settings: { autoAcceptJoins: true } },
      jwts.member,
    );
    expect(res.ok).toBe(false);
  });

  it('an org owner who is not an enterprise admin cannot change enterprise settings', async () => {
    const res = await wormhole(
      'enterprises.updateSettings',
      { enterpriseId: enterpriseId.toHexString(), settings: { autoAcceptJoins: true } },
      jwts.orgOwner,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/enterprise owner or admin/);
  });

  it('a plain member cannot change enterprise settings', async () => {
    const res = await wormhole(
      'enterprises.updateSettings',
      { enterpriseId: enterpriseId.toHexString(), settings: { autoAcceptJoins: true } },
      jwts.member,
    );
    expect(res.ok).toBe(false);
  });
});
