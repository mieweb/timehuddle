/**
 * Teams — wormhole REST integration tests.
 *
 * Fixture: OWNER (team admin), MEMBER (regular), OUTSIDER (not in team).
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
});

afterAll(async () => {
  await Promise.all([purgeUser(OWNER.email), purgeUser(MEMBER.email), purgeUser(OUTSIDER.email)]);
  await closeDb();
});

describe('teams (wormhole)', () => {
  let createdTeamId: string;

  it('creates a team', async () => {
    const res = await wormhole<{ team: { id: string; name: string; admins: string[]; members: string[] } }>(
      'teams.create',
      { name: 'WH Test Team' },
      ownerJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.team.name).toBe('WH Test Team');
    expect(res.result.team.admins).toContain(ownerId);
    expect(res.result.team.members).toContain(ownerId);
    createdTeamId = res.result.team.id;
  });

  it('lists teams for the caller', async () => {
    const res = await wormhole<{ teams: Array<{ id: string; name: string }> }>(
      'teams.list',
      {},
      ownerJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.teams.some((t) => t.id === createdTeamId)).toBe(true);
  });

  it('ensures personal workspace (idempotent)', async () => {
    const res1 = await wormhole<{ team: { id: string; isPersonal: boolean } }>(
      'teams.ensurePersonal',
      {},
      memberJwt,
    );
    expect(res1.ok).toBe(true);
    expect(res1.result.team.isPersonal).toBe(true);

    const res2 = await wormhole<{ team: { id: string } }>('teams.ensurePersonal', {}, memberJwt);
    expect(res2.result.team.id).toBe(res1.result.team.id);
  });

  it('renames a team (admin only)', async () => {
    const res = await wormhole<{ team: { id: string; name: string } }>(
      'teams.rename',
      { teamId: createdTeamId, newName: 'Renamed Team' },
      ownerJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.team.name).toBe('Renamed Team');
  });

  it('non-admin cannot rename', async () => {
    const res = await wormhole(
      'teams.rename',
      { teamId: createdTeamId, newName: 'Nope' },
      outsiderJwt,
    );
    expect(res.ok).toBe(false);
  });

  it('invites a member by email', async () => {
    const res = await wormhole<{ ok: boolean }>(
      'teams.invite',
      { teamId: createdTeamId, email: MEMBER.email },
      ownerJwt,
    );
    expect(res.ok).toBe(true);
  });

  it('gets team members', async () => {
    const res = await wormhole<{ members: Array<{ id: string; name: string }> }>(
      'teams.getMembers',
      { teamId: createdTeamId },
      ownerJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.members.length).toBeGreaterThanOrEqual(2);
    expect(res.result.members.some((m) => m.id === memberId)).toBe(true);
  });

  it('sets member role to admin', async () => {
    const res = await wormhole<{ ok: boolean }>(
      'teams.setRole',
      { teamId: createdTeamId, userId: memberId, role: 'admin' },
      ownerJwt,
    );
    expect(res.ok).toBe(true);
  });

  it('joins a team by code', async () => {
    // Create a separate team for the join-by-code test (outsider is NOT a member)
    const joinRes = await wormhole<{ team: { id: string; code: string } }>(
      'teams.create',
      { name: 'Join Code Team' },
      ownerJwt,
    );
    expect(joinRes.ok).toBe(true);
    const joinTeamId = joinRes.result.team.id;

    const db = await getDb();
    const team = await db.collection('teams').findOne({ _id: new ObjectId(joinTeamId) });

    const res = await wormhole<{ team: { id: string; members: string[] } }>(
      'teams.join',
      { teamCode: team!.code },
      outsiderJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.team.members).toContain(outsiderId);

    // Cleanup
    await wormhole('teams.delete', { teamId: joinTeamId }, ownerJwt);
  });

  it('removes a member (admin only)', async () => {
    await wormhole('teams.invite', { teamId: createdTeamId, email: OUTSIDER.email }, ownerJwt);
    const res = await wormhole<{ ok: boolean }>(
      'teams.removeMember',
      { teamId: createdTeamId, userId: outsiderId },
      ownerJwt,
    );
    expect(res.ok).toBe(true);
  });

  it('deletes a team (admin only)', async () => {
    const res = await wormhole<{ ok: boolean }>('teams.delete', { teamId: createdTeamId }, ownerJwt);
    expect(res.ok).toBe(true);
  });
});
