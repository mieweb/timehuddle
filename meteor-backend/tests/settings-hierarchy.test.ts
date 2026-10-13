/**
 * Hierarchical settings write APIs — wormhole REST integration tests, #607.
 *
 * Fixture: enterprise > org > team, with an enterprise admin, an org owner, a
 * team admin and a plain team member.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  createUserAndGetJwt,
  wormhole,
  getDb,
  closeDb,
  purgeUser,
  ObjectId,
  DDPConnection,
  type SettingValue,
} from './helpers';
import { METEOR_URL } from './setup';

const USERS = {
  entAdmin: { name: 'Set Ent Admin', email: 'wh-set-ent-admin@test.dev', password: 'Password1!' },
  orgOwner: { name: 'Set Org Owner', email: 'wh-set-org-owner@test.dev', password: 'Password1!' },
  teamAdmin: { name: 'Set Team Admin', email: 'wh-set-team-admin@test.dev', password: 'Password1!' },
  member: { name: 'Set Member', email: 'wh-set-member@test.dev', password: 'Password1!' },
};

type Settings = { requirePlanForClock: SettingValue; autoAcceptJoins: SettingValue };
type TeamsList = { teams: Array<{ id: string; settings: Settings }> };

const jwts = {} as Record<keyof typeof USERS, string>;
const ids = {} as Record<keyof typeof USERS, string>;
const enterpriseId = new ObjectId();
const orgId = new ObjectId();
const teamId = new ObjectId();
const ownValueTeamId = new ObjectId();

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
  await db.collection('teams').insertOne({
    _id: ownValueTeamId,
    orgId: orgId.toHexString(),
    name: 'Settings Team With Own Value',
    members: [ids.teamAdmin, ids.member],
    admins: [ids.teamAdmin],
    code: 'WHSETT02',
    isPersonal: false,
    settings: { requirePlanForClock: false },
    createdAt: now,
  });
}, 60000);

afterAll(async () => {
  const db = await getDb();
  await db.collection('teams').deleteMany({ _id: { $in: [teamId, ownValueTeamId] } });
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
  await db
    .collection('teams')
    .updateOne({ _id: ownValueTeamId }, { $set: { settings: { requirePlanForClock: false } } });
  await db.collection('notifications').deleteMany({ userId: { $in: [ids.member, ids.teamAdmin] } });
});

describe('org defaults', () => {
  it('a team with no value inherits the org default', async () => {
    const res = await wormhole(
      'orgs.updateSettings',
      { orgId: orgId.toHexString(), settings: { requirePlanForClock: false } },
      jwts.orgOwner,
    );
    expect(res.ok).toBe(true);
    expect((await teamSettings()).requirePlanForClock).toEqual({
      value: false,
      source: 'org',
      sourceId: orgId.toHexString(),
      locked: false,
    });
  });

  it('an org inherits the enterprise default, and so does its team', async () => {
    const res = await wormhole(
      'enterprises.updateSettings',
      { enterpriseId: enterpriseId.toHexString(), settings: { autoAcceptJoins: true } },
      jwts.entAdmin,
    );
    expect(res.ok).toBe(true);
    expect((await teamSettings()).autoAcceptJoins).toMatchObject({
      value: true,
      source: 'enterprise',
    });

    const org = await wormhole<{
      organization: { allowAutoJoin: boolean; effectiveSettings: Record<string, SettingValue> };
    }>('orgs.get', { orgId: orgId.toHexString() }, jwts.orgOwner);
    expect(org.result.organization.allowAutoJoin).toBe(true);
    expect(org.result.organization.effectiveSettings.autoAcceptJoins).toMatchObject({
      value: true,
      source: 'enterprise',
    });
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
    expect((await teamSettings()).autoAcceptJoins).toMatchObject({
      value: false,
      source: 'org',
      locked: true,
    });
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
    expect((await teamSettings()).requirePlanForClock).toMatchObject({
      value: true,
      source: 'team',
    });

    const reset = await wormhole(
      'teams.updateSettings',
      { teamId: teamId.toHexString(), requirePlanForClock: null },
      jwts.teamAdmin,
    );
    expect(reset.ok).toBe(true);
    expect((await teamSettings()).requirePlanForClock).toMatchObject({
      value: false,
      source: 'org',
    });

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

describe('plan requirement notifications', () => {
  async function planNotifiedTeamIds(userId: string): Promise<string[]> {
    const db = await getDb();
    const rows = await db
      .collection('notifications')
      .find({ userId, 'data.type': 'team-setting-change' })
      .toArray();
    return rows.map((row) => row.data.teamId);
  }

  async function orgSets(requirePlanForClock: boolean) {
    const res = await wormhole(
      'orgs.updateSettings',
      { orgId: orgId.toHexString(), settings: { requirePlanForClock } },
      jwts.orgOwner,
    );
    expect(res.ok).toBe(true);
  }

  it('an org default turning on notifies an inheriting team but not one with its own value', async () => {
    await orgSets(false);
    expect(await planNotifiedTeamIds(ids.member)).toEqual([]);

    await orgSets(true);
    expect(await planNotifiedTeamIds(ids.member)).toEqual([teamId.toHexString()]);
    expect(await planNotifiedTeamIds(ids.teamAdmin)).toEqual([teamId.toHexString()]);
  });

  it('turning the default off, or leaving it on, notifies nobody', async () => {
    await orgSets(true);
    await orgSets(false);
    await orgSets(false);
    expect(await planNotifiedTeamIds(ids.member)).toEqual([]);
  });

  it('an enterprise default turning on reaches the teams below it', async () => {
    await wormhole(
      'enterprises.updateSettings',
      { enterpriseId: enterpriseId.toHexString(), settings: { requirePlanForClock: false } },
      jwts.entAdmin,
    );
    const res = await wormhole(
      'enterprises.updateSettings',
      { enterpriseId: enterpriseId.toHexString(), settings: { requirePlanForClock: true } },
      jwts.entAdmin,
    );
    expect(res.ok).toBe(true);
    expect(await planNotifiedTeamIds(ids.member)).toEqual([teamId.toHexString()]);
  });

  it('a team switching its own value on notifies its members except the admin', async () => {
    await orgSets(false);
    const res = await wormhole(
      'teams.updateSettings',
      { teamId: teamId.toHexString(), requirePlanForClock: true },
      jwts.teamAdmin,
    );
    expect(res.ok).toBe(true);
    expect(await planNotifiedTeamIds(ids.member)).toEqual([teamId.toHexString()]);
    expect(await planNotifiedTeamIds(ids.teamAdmin)).toEqual([]);
  });

  it('a lock turning the requirement on overrides a team that had it off', async () => {
    const res = await wormhole(
      'orgs.updateSettings',
      {
        orgId: orgId.toHexString(),
        settings: { requirePlanForClock: true },
        locks: { requirePlanForClock: true },
      },
      jwts.orgOwner,
    );
    expect(res.ok).toBe(true);
    expect(await planNotifiedTeamIds(ids.member)).toContain(ownValueTeamId.toHexString());
  });
});

describe('teams.byUser publication', () => {
  let ddp: DDPConnection;

  const published = (id: ObjectId) => ddp.docs.get('teams')?.get(id.toHexString());

  async function waitForPublished(check: () => boolean) {
    for (let i = 0; i < 50 && !check(); i += 1) await new Promise((r) => setTimeout(r, 100));
    expect(check()).toBe(true);
  }

  beforeEach(async () => {
    await wormhole(
      'orgs.updateSettings',
      { orgId: orgId.toHexString(), settings: { requirePlanForClock: false } },
      jwts.orgOwner,
    );
    ddp = new DDPConnection(METEOR_URL.replace('http://', 'ws://') + '/websocket');
    await ddp.connect();
    await ddp.login(USERS.member.email, USERS.member.password);
    await ddp.subscribe('teams.byUser');
  });

  afterEach(() => ddp.close());

  it('publishes resolved settings instead of the stored ones', async () => {
    expect(published(teamId)?.settings).toMatchObject({
      requirePlanForClock: { value: false, source: 'org', locked: false },
      autoAcceptJoins: { value: false, source: 'system', locked: false },
    });
    expect(published(ownValueTeamId)?.settings).toMatchObject({
      requirePlanForClock: { value: false, source: 'team' },
    });
  });

  it('pushes an org change to a subscriber without a resubscribe', async () => {
    await wormhole(
      'orgs.updateSettings',
      { orgId: orgId.toHexString(), settings: { requirePlanForClock: true } },
      jwts.orgOwner,
    );
    await waitForPublished(
      () =>
        (published(teamId)?.settings as { requirePlanForClock: SettingValue } | undefined)
          ?.requirePlanForClock.value === true,
    );
    expect(published(teamId)?.settings).toMatchObject({
      requirePlanForClock: { value: true, source: 'org' },
    });
  });

  it('pushes a change to the team as resolved settings', async () => {
    await wormhole(
      'teams.updateSettings',
      { teamId: teamId.toHexString(), requirePlanForClock: true },
      jwts.teamAdmin,
    );
    await waitForPublished(
      () =>
        (published(teamId)?.settings as { requirePlanForClock: SettingValue } | undefined)
          ?.requirePlanForClock.source === 'team',
    );
    expect(published(teamId)?.settings).toMatchObject({
      requirePlanForClock: { value: true, source: 'team' },
    });
  });
});

describe('sub-teams', () => {
  const parentId = new ObjectId();
  const childId = new ObjectId();

  beforeAll(async () => {
    const db = await getDb();
    const base = {
      orgId: orgId.toHexString(),
      members: [ids.teamAdmin],
      admins: [ids.teamAdmin],
      isPersonal: false,
      createdAt: new Date(),
    };
    await db.collection('teams').insertMany([
      {
        ...base,
        _id: parentId,
        name: 'Settings Parent',
        code: 'WHSETP01',
        settings: { autoAcceptJoins: true, requirePlanForClock: false },
      },
      {
        ...base,
        _id: childId,
        name: 'Settings Child',
        code: 'WHSETP02',
        members: [ids.teamAdmin, ids.member],
        parentTeamId: parentId.toHexString(),
      },
    ]);
  });

  afterAll(async () => {
    const db = await getDb();
    await db.collection('teams').deleteMany({ _id: { $in: [parentId, childId] } });
  });

  it('a sub-team inherits its parent team before the org', async () => {
    await wormhole(
      'orgs.updateSettings',
      { orgId: orgId.toHexString(), settings: { autoAcceptJoins: false } },
      jwts.orgOwner,
    );
    const res = await wormhole<TeamsList>('teams.list', {}, jwts.teamAdmin);
    const child = res.result.teams.find((t) => t.id === childId.toHexString());
    expect(child?.settings.autoAcceptJoins).toEqual({
      value: true,
      source: 'parentTeam',
      sourceId: parentId.toHexString(),
      locked: false,
    });
  });

  it('notifies the members of a sub-team when its parent turns the plan requirement on', async () => {
    const db = await getDb();
    await db.collection('teams').updateOne(
      { _id: parentId },
      { $set: { 'settings.requirePlanForClock': false } },
    );
    await wormhole(
      'orgs.updateSettings',
      { orgId: orgId.toHexString(), settings: { requirePlanForClock: false } },
      jwts.orgOwner,
    );
    await db.collection('notifications').deleteMany({ userId: ids.member });

    const res = await wormhole(
      'teams.updateSettings',
      { teamId: parentId.toHexString(), requirePlanForClock: true },
      jwts.teamAdmin,
    );
    expect(res.ok).toBe(true);

    const rows = await db
      .collection('notifications')
      .find({ userId: ids.member, 'data.type': 'team-setting-change' })
      .toArray();
    expect(rows.map((row) => row.data.teamId)).toEqual([childId.toHexString()]);
  });
});

describe('org creation under an enterprise lock', () => {
  const orgName = 'Settings Locked Create Org';

  beforeEach(async () => {
    await wormhole(
      'enterprises.updateSettings',
      {
        enterpriseId: enterpriseId.toHexString(),
        settings: { allowAutoJoin: true },
        locks: { allowAutoJoin: true },
      },
      jwts.entAdmin,
    );
  });

  afterEach(async () => {
    const db = await getDb();
    await db.collection('organizations').deleteMany({ name: orgName });
  });

  it('refuses a value that conflicts with the lock', async () => {
    const res = await wormhole(
      'orgs.create',
      { enterpriseId: enterpriseId.toHexString(), name: orgName, allowAutoJoin: false },
      jwts.entAdmin,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/locked by the enterprise/);
  });

  it('accepts the locked value without storing it', async () => {
    const res = await wormhole<{ organization: { id: string } }>(
      'orgs.create',
      { enterpriseId: enterpriseId.toHexString(), name: orgName, allowAutoJoin: true },
      jwts.entAdmin,
    );
    expect(res.ok).toBe(true);

    const db = await getDb();
    const org = await db
      .collection('organizations')
      .findOne({ _id: new ObjectId(res.result.organization.id) });
    expect(org?.settings).toEqual({});
  });

  it('refuses an update that conflicts with the lock', async () => {
    const res = await wormhole(
      'orgs.update',
      { orgId: orgId.toHexString(), allowAutoJoin: false },
      jwts.orgOwner,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/locked by the enterprise/);
  });
});
