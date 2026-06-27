/**
 * Teams — wormhole REST integration tests.
 *
 * Fixture: OWNER (team admin), MEMBER (regular), OUTSIDER (not in team).
 * Ported from backend/tests/teams.test.ts (Fastify) to Meteor wormhole calls.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createUserAndGetJwt,
  wormhole,
  getDb,
  closeDb,
  purgeUser,
  ObjectId,
} from './helpers';

const OWNER = { name: 'Team Owner', email: 'wh-team-owner@test.dev', password: 'Password1!' };
const MEMBER = { name: 'Team Member', email: 'wh-team-member@test.dev', password: 'Password1!' };
const OUTSIDER = { name: 'Team Outsider', email: 'wh-team-outsider@test.dev', password: 'Password1!' };

let ownerJwt: string;
let memberJwt: string;
let outsiderJwt: string;
let ownerId: string;
let memberId: string;
let outsiderId: string;
let fixtureTeamId: string;

beforeAll(async () => {
  await Promise.all([purgeUser(OWNER.email), purgeUser(MEMBER.email), purgeUser(OUTSIDER.email)]);
  const [owner, member, outsider] = await Promise.all([
    createUserAndGetJwt(OWNER),
    createUserAndGetJwt(MEMBER),
    createUserAndGetJwt(OUTSIDER),
  ]);
  ownerJwt = owner.jwt;
  memberJwt = member.jwt;
  outsiderJwt = outsider.jwt;

  const db = await getDb();
  ownerId = String((await db.collection('user').findOne({ email: OWNER.email }))!._id);
  memberId = String((await db.collection('user').findOne({ email: MEMBER.email }))!._id);
  outsiderId = String((await db.collection('user').findOne({ email: OUTSIDER.email }))!._id);

  // Create a shared fixture team via wormhole, then add the member
  const createRes = await wormhole<{ team: { id: string } }>(
    'teams.create',
    { name: 'Fixture Team' },
    ownerJwt,
  );
  fixtureTeamId = createRes.result.team.id;
  await wormhole('teams.invite', { teamId: fixtureTeamId, email: MEMBER.email }, ownerJwt);
}, 30000);

afterAll(async () => {
  // Clean up fixture team (may already be deleted by tests)
  await wormhole('teams.delete', { teamId: fixtureTeamId }, ownerJwt).catch(() => {});
  await Promise.all([purgeUser(OWNER.email), purgeUser(MEMBER.email), purgeUser(OUTSIDER.email)]);
  await closeDb();
});

// ─── Auth gate ────────────────────────────────────────────────────────────────

describe('auth gate', () => {
  it('rejects unauthenticated calls', async () => {
    const res = await wormhole('teams.list', {}, 'bad-jwt-token');
    expect(res.ok).toBe(false);
  });
});

// ─── teams.list ──────────────────────────────────────────────────────────────

describe('teams.list', () => {
  it('returns teams for owner', async () => {
    const res = await wormhole<{ teams: Array<{ id: string; name: string; members: string[]; admins: string[] }> }>(
      'teams.list',
      {},
      ownerJwt,
    );
    expect(res.ok).toBe(true);
    const fixture = res.result.teams.find((t) => t.id === fixtureTeamId);
    expect(fixture).toBeDefined();
    expect(fixture!.name).toBe('Fixture Team');
    expect(fixture!.members).toContain(ownerId);
    expect(fixture!.admins).toContain(ownerId);
  });

  it('does not return the fixture team for outsider', async () => {
    const res = await wormhole<{ teams: Array<{ id: string }> }>('teams.list', {}, outsiderJwt);
    expect(res.ok).toBe(true);
    expect(res.result.teams.find((t) => t.id === fixtureTeamId)).toBeUndefined();
  });
});

// ─── teams.ensurePersonal ────────────────────────────────────────────────────

describe('teams.ensurePersonal', () => {
  it('creates a personal workspace when none exists', async () => {
    const res = await wormhole<{ team: { id: string; isPersonal: boolean; members: string[] } }>(
      'teams.ensurePersonal',
      {},
      outsiderJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.team.isPersonal).toBe(true);
    expect(res.result.team.members).toContain(outsiderId);
  });

  it('is idempotent — calling twice returns the same team', async () => {
    const res1 = await wormhole<{ team: { id: string } }>('teams.ensurePersonal', {}, memberJwt);
    const res2 = await wormhole<{ team: { id: string } }>('teams.ensurePersonal', {}, memberJwt);
    expect(res1.ok).toBe(true);
    expect(res2.ok).toBe(true);
    expect(res1.result.team.id).toBe(res2.result.team.id);
  });
});

// ─── teams.create ────────────────────────────────────────────────────────────

describe('teams.create', () => {
  it('creates a team', async () => {
    const res = await wormhole<{
      team: { id: string; name: string; description: string | null; members: string[]; admins: string[]; isPersonal: boolean; code: string };
    }>('teams.create', { name: 'New Team', description: 'A brand new team' }, ownerJwt);
    expect(res.ok).toBe(true);
    expect(res.result.team.name).toBe('New Team');
    expect(res.result.team.description).toBe('A brand new team');
    expect(res.result.team.members).toContain(ownerId);
    expect(res.result.team.admins).toContain(ownerId);
    expect(res.result.team.isPersonal).toBe(false);
    expect(typeof res.result.team.code).toBe('string');

    // cleanup
    await wormhole('teams.delete', { teamId: res.result.team.id }, ownerJwt);
  });

  it('rejects missing name', async () => {
    const res = await wormhole('teams.create', {}, ownerJwt);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/name/i);
  });

  it('rejects empty name', async () => {
    const res = await wormhole('teams.create', { name: '   ' }, ownerJwt);
    expect(res.ok).toBe(false);
  });
});

// ─── teams.join ──────────────────────────────────────────────────────────────

describe('teams.join', () => {
  let joinTeamId: string;
  let joinTeamCode: string;

  beforeAll(async () => {
    const res = await wormhole<{ team: { id: string } }>(
      'teams.create',
      { name: 'Join Code Team' },
      ownerJwt,
    );
    joinTeamId = res.result.team.id;
    const db = await getDb();
    const team = await db.collection('teams').findOne({ _id: new ObjectId(joinTeamId) });
    joinTeamCode = team!.code;
  });

  afterAll(async () => {
    const db = await getDb();
    await db.collection('teams').deleteOne({ _id: new ObjectId(joinTeamId) });
  });

  it('joins an existing team by code', async () => {
    const res = await wormhole<{ team: { id: string; members: string[] } }>(
      'teams.join',
      { teamCode: joinTeamCode },
      outsiderJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.team.members).toContain(outsiderId);

    // cleanup: remove outsider so other tests can re-join
    const db = await getDb();
    await db.collection('teams').updateOne(
      { _id: new ObjectId(joinTeamId) },
      { $pull: { members: outsiderId } } as any,
    );
  });

  it('returns error for bad code', async () => {
    const res = await wormhole('teams.join', { teamCode: 'BADCODE999' }, outsiderJwt);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });

  it('returns error if already a member', async () => {
    const res = await wormhole('teams.join', { teamCode: joinTeamCode }, ownerJwt);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/already/i);
  });
});

// ─── teams.rename ────────────────────────────────────────────────────────────

describe('teams.rename', () => {
  it('admin can rename', async () => {
    const res = await wormhole<{ team: { id: string; name: string } }>(
      'teams.rename',
      { teamId: fixtureTeamId, newName: 'Renamed Team' },
      ownerJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.team.name).toBe('Renamed Team');
    // restore
    await wormhole('teams.rename', { teamId: fixtureTeamId, newName: 'Fixture Team' }, ownerJwt);
  });

  it('non-admin member is forbidden', async () => {
    const res = await wormhole(
      'teams.rename',
      { teamId: fixtureTeamId, newName: 'Hacked' },
      memberJwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/admin/i);
  });

  it('outsider is forbidden', async () => {
    const res = await wormhole(
      'teams.rename',
      { teamId: fixtureTeamId, newName: 'Hacked' },
      outsiderJwt,
    );
    expect(res.ok).toBe(false);
  });
});

// ─── teams.getMembers ────────────────────────────────────────────────────────

describe('teams.getMembers', () => {
  it('returns members with name and email', async () => {
    const res = await wormhole<{ members: Array<{ id: string; name: string; email: string }> }>(
      'teams.getMembers',
      { teamId: fixtureTeamId },
      ownerJwt,
    );
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.result.members)).toBe(true);
    const ownerEntry = res.result.members.find((m) => m.id === ownerId);
    expect(ownerEntry).toBeDefined();
    expect(ownerEntry!.name).toBe(OWNER.name);
    expect(ownerEntry!.email).toBe(OWNER.email);
  });

  it('outsider is forbidden', async () => {
    const res = await wormhole(
      'teams.getMembers',
      { teamId: fixtureTeamId },
      outsiderJwt,
    );
    expect(res.ok).toBe(false);
  });
});

// ─── teams.invite ────────────────────────────────────────────────────────────

describe('teams.invite', () => {
  it('adds user to team by email', async () => {
    const res = await wormhole<{ ok: boolean }>(
      'teams.invite',
      { teamId: fixtureTeamId, email: OUTSIDER.email },
      ownerJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.ok).toBe(true);
    // cleanup
    const db = await getDb();
    await db.collection('teams').updateOne(
      { _id: new ObjectId(fixtureTeamId) },
      { $pull: { members: outsiderId } } as any,
    );
  });

  it('returns error for unknown email', async () => {
    const res = await wormhole(
      'teams.invite',
      { teamId: fixtureTeamId, email: 'nobody@nowhere.test' },
      ownerJwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });

  it('returns error if already a member', async () => {
    const res = await wormhole(
      'teams.invite',
      { teamId: fixtureTeamId, email: MEMBER.email },
      ownerJwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/already/i);
  });
});

// ─── teams.setRole ───────────────────────────────────────────────────────────

describe('teams.setRole', () => {
  it('admin can promote member to admin', async () => {
    const res = await wormhole<{ ok: boolean }>(
      'teams.setRole',
      { teamId: fixtureTeamId, userId: memberId, role: 'admin' },
      ownerJwt,
    );
    expect(res.ok).toBe(true);
    // verify
    const db = await getDb();
    const team = await db.collection('teams').findOne({ _id: new ObjectId(fixtureTeamId) });
    expect(team?.admins).toContain(memberId);
    // demote back
    await wormhole(
      'teams.setRole',
      { teamId: fixtureTeamId, userId: memberId, role: 'member' },
      ownerJwt,
    );
  });

  it('non-admin is forbidden', async () => {
    const res = await wormhole(
      'teams.setRole',
      { teamId: fixtureTeamId, userId: ownerId, role: 'member' },
      memberJwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/admin/i);
  });

  it('cannot demote last admin', async () => {
    const res = await wormhole(
      'teams.setRole',
      { teamId: fixtureTeamId, userId: ownerId, role: 'member' },
      ownerJwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/last admin/i);
  });
});

// ─── teams.removeMember ──────────────────────────────────────────────────────

describe('teams.removeMember', () => {
  it('admin can remove a regular member', async () => {
    // add outsider via the invite method so Meteor sees the change
    const inviteRes = await wormhole('teams.invite', { teamId: fixtureTeamId, email: OUTSIDER.email }, ownerJwt);
    expect(inviteRes.ok).toBe(true);

    const res = await wormhole<{ ok: boolean }>(
      'teams.removeMember',
      { teamId: fixtureTeamId, userId: outsiderId },
      ownerJwt,
    );
    expect(res.ok).toBe(true);
    const db = await getDb();
    const team = await db.collection('teams').findOne({ _id: new ObjectId(fixtureTeamId) });
    expect(team?.members).not.toContain(outsiderId);
  });

  it('non-admin is forbidden', async () => {
    const res = await wormhole(
      'teams.removeMember',
      { teamId: fixtureTeamId, userId: ownerId },
      memberJwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/admin/i);
  });

  it('cannot remove self', async () => {
    const res = await wormhole(
      'teams.removeMember',
      { teamId: fixtureTeamId, userId: ownerId },
      ownerJwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/yourself/i);
  });
});

// ─── teams.delete ────────────────────────────────────────────────────────────

describe('teams.delete', () => {
  it('admin can delete a team', async () => {
    // create a temp team to delete
    const createRes = await wormhole<{ team: { id: string } }>(
      'teams.create',
      { name: 'To Delete' },
      ownerJwt,
    );
    expect(createRes.ok).toBe(true);
    const tmpId = createRes.result.team.id;

    const res = await wormhole<{ ok: boolean }>('teams.delete', { teamId: tmpId }, ownerJwt);
    expect(res.ok).toBe(true);
    const db = await getDb();
    const gone = await db.collection('teams').findOne({ _id: new ObjectId(tmpId) });
    expect(gone).toBeNull();
  });

  it('non-admin is forbidden', async () => {
    const res = await wormhole('teams.delete', { teamId: fixtureTeamId }, memberJwt);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/admin/i);
  });

  it('outsider is forbidden', async () => {
    const res = await wormhole('teams.delete', { teamId: fixtureTeamId }, outsiderJwt);
    expect(res.ok).toBe(false);
  });
});
