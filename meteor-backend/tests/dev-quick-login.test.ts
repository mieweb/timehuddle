/**
 * Dev one-click sign-in — DDP login handler integration tests.
 *
 * This handler hands out org-owner and enterprise-owner sessions without a
 * password, so what it provisions matters. It also re-provisions on every
 * sign-in rather than topping up, because the fixtures are exactly the
 * accounts a developer edits while testing role management and blocking —
 * the cases below drive a fixture into each of those damaged states and
 * assert the next sign-in puts it back.
 *
 * Runs against the test Meteor instance, which is `meteor run` and therefore
 * development mode; a production server never registers the handler at all.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DDPConnection, getDb, closeDb, ObjectId } from './helpers';
import { METEOR_URL } from './setup';

const FIXTURES = {
  member: { email: 'dev-member@test.local', orgRole: 'member', teamAdmin: false, ent: null },
  'org-admin': { email: 'dev-admin@test.local', orgRole: 'admin', teamAdmin: true, ent: null },
  'org-owner': { email: 'dev-owner@test.local', orgRole: 'owner', teamAdmin: true, ent: null },
  'enterprise-admin': {
    email: 'dev-enterprise-admin@test.local',
    orgRole: 'admin',
    teamAdmin: true,
    ent: 'admins',
  },
  'enterprise-owner': {
    email: 'dev-enterprise-owner@test.local',
    orgRole: 'owner',
    teamAdmin: true,
    ent: 'owners',
  },
} as const;

type Role = keyof typeof FIXTURES;
const ROLES = Object.keys(FIXTURES) as Role[];

async function quickLogin(role: string): Promise<{ id: string; token: string }> {
  const ddp = new DDPConnection(METEOR_URL.replace('http://', 'ws://') + '/websocket');
  try {
    await ddp.connect();
    return (await ddp.call('login', [{ devQuickLogin: { role } }])) as {
      id: string;
      token: string;
    };
  } finally {
    ddp.close();
  }
}

async function findFixture(email: string) {
  const db = await getDb();
  return db.collection('users').findOne({ 'emails.address': email });
}

/** Everything the handler is supposed to have provisioned, in one shape. */
async function readProvisionedState(userId: string) {
  const db = await getDb();
  const org = await db
    .collection('organizations')
    .findOne({ slug: process.env.DEFAULT_ORG_KEY ?? 'default' });
  const orgId = org!._id.toHexString();
  const [membership, enterprise, devTeam, personalTeams] = await Promise.all([
    db.collection('org_members').findOne({ orgId, userId }),
    org!.enterpriseId
      ? db.collection('enterprises').findOne({ _id: new ObjectId(String(org!.enterpriseId)) })
      : null,
    db.collection('teams').findOne({ orgId, name: 'Dev Team' }),
    db.collection('teams').find({ isPersonal: true, members: userId }).toArray(),
  ]);

  return {
    orgId,
    orgRole: membership?.role ?? null,
    orgOwner: (org!.owners ?? []).includes(userId),
    orgAdmin: (org!.admins ?? []).includes(userId),
    entOwner: (enterprise?.owners ?? []).includes(userId),
    entAdmin: (enterprise?.admins ?? []).includes(userId),
    devTeamMember: (devTeam?.members ?? []).includes(userId),
    devTeamAdmin: (devTeam?.admins ?? []).includes(userId),
    personalTeamCount: personalTeams.length,
  };
}

/** Delete a fixture and every trace of it, so the next login is a first use. */
async function purgeFixture(email: string) {
  const db = await getDb();
  const user = await db.collection('users').findOne({ 'emails.address': email });
  if (!user) return;
  const userId = String(user._id);

  await db.collection('teams').deleteMany({ isPersonal: true, members: userId });
  await db.collection('teams').updateMany({}, { $pull: { members: userId, admins: userId } } as never);
  await db.collection('organizations').updateMany({}, { $pull: { owners: userId, admins: userId } } as never);
  await db.collection('enterprises').updateMany({}, { $pull: { owners: userId, admins: userId } } as never);
  await db.collection('org_members').deleteMany({ userId });
  await db.collection('users').deleteOne({ _id: user._id as never });
}

describe('dev quick login', () => {
  beforeAll(async () => {
    await purgeFixture(FIXTURES.member.email);
  });

  afterAll(async () => {
    for (const { email } of Object.values(FIXTURES)) await purgeFixture(email);
    await closeDb();
  });

  it('creates the fixture on first use and reuses it afterwards', async () => {
    expect(await findFixture(FIXTURES.member.email)).toBeNull();

    const first = await quickLogin('member');
    const created = await findFixture(FIXTURES.member.email);
    expect(created).not.toBeNull();
    expect(created!.emails[0].verified).toBe(true);
    expect(first.token).toBeTruthy();

    const second = await quickLogin('member');
    expect(second.id).toBe(first.id);

    const db = await getDb();
    expect(
      await db.collection('users').countDocuments({ 'emails.address': FIXTURES.member.email }),
    ).toBe(1);
    expect((await readProvisionedState(first.id)).personalTeamCount).toBe(1);
  });

  it.each(ROLES)('provisions exactly the %s role', async (role) => {
    const spec = FIXTURES[role];
    const { id: userId } = await quickLogin(role);
    const state = await readProvisionedState(userId);

    expect(state.orgRole).toBe(spec.orgRole);
    expect(state.orgOwner).toBe(spec.orgRole === 'owner');
    expect(state.orgAdmin).toBe(spec.orgRole === 'admin');
    expect(state.entOwner).toBe(spec.ent === 'owners');
    expect(state.entAdmin).toBe(spec.ent === 'admins');
    expect(state.devTeamMember).toBe(true);
    expect(state.devTeamAdmin).toBe(spec.teamAdmin);
    expect(state.personalTeamCount).toBe(1);
  });

  it('demotes a fixture that was elevated since the last sign-in', async () => {
    const { id: userId } = await quickLogin('member');
    const { orgId } = await readProvisionedState(userId);
    const db = await getDb();

    // Exactly what promoting this user through the org UI would leave behind.
    await db.collection('org_members').updateOne({ orgId, userId }, { $set: { role: 'owner' } });
    await db
      .collection('organizations')
      .updateOne({ _id: new ObjectId(orgId) }, { $addToSet: { owners: userId } });
    await db.collection('enterprises').updateMany({}, { $addToSet: { admins: userId } });
    await db.collection('teams').updateOne({ orgId, name: 'Dev Team' }, { $addToSet: { admins: userId } });

    await quickLogin('member');

    const state = await readProvisionedState(userId);
    expect(state.orgRole).toBe('member');
    expect(state.orgOwner).toBe(false);
    expect(state.entAdmin).toBe(false);
    expect(state.entOwner).toBe(false);
    expect(state.devTeamAdmin).toBe(false);
    expect(state.devTeamMember).toBe(true);
  });

  it('recovers a fixture that was blocked, without duplicating its personal team', async () => {
    const { id: userId } = await quickLogin('member');
    const { orgId } = await readProvisionedState(userId);
    const db = await getDb();

    // The state orgs.blockMember leaves: a block record naming the teams it
    // pulled the user out of, and the user gone from those teams.
    const personal = await db.collection('teams').findOne({ isPersonal: true, members: userId });
    await db.collection('users').updateOne(
      { _id: userId as never },
      {
        $push: {
          blocked: {
            orgId,
            blockedBy: 'someone',
            blockedAt: new Date(),
            reason: 'e2e',
            removedFromTeams: [{ teamId: personal!._id.toHexString(), wasAdmin: true }],
          },
        } as never,
      },
    );
    await db
      .collection('teams')
      .updateMany({ orgId }, { $pull: { members: userId, admins: userId } } as never);

    // Left blocked, validateLoginAttempt rejects this outright.
    const { id: again } = await quickLogin('member');
    expect(again).toBe(userId);

    const after = await db.collection('users').findOne({ _id: userId as never });
    expect(after!.blocked ?? []).toHaveLength(0);

    const state = await readProvisionedState(userId);
    expect(state.personalTeamCount).toBe(1);
    expect(state.devTeamMember).toBe(true);
  });

  it('rejects an unknown role', async () => {
    await expect(quickLogin('superuser')).rejects.toThrow(/Unknown dev role/);
  });
});
