/**
 * `tickets.carryIssue` (#736) — wormhole REST integration tests.
 *
 * No Redmine is reachable from the test backend, so these cover what needs
 * none: who may ask, and finding the ticket a team already carries an issue on.
 * Creating a carrier is covered by tests/ticket-carry-core.test.ts.
 *
 * Fixture: MEMBER and ADMIN in one team, OTHER in a second team, OUTSIDER in none.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createUserAndGetJwt, wormhole, getDb, purgeUser, ObjectId } from './helpers';

const ADMIN = { name: 'Carry Admin', email: 'wh-carry-admin@test.dev', password: 'Password1!' };
const MEMBER = { name: 'Carry Member', email: 'wh-carry-member@test.dev', password: 'Password1!' };
const OTHER = { name: 'Carry Other', email: 'wh-carry-other@test.dev', password: 'Password1!' };
const OUTSIDER = {
  name: 'Carry Outsider',
  email: 'wh-carry-outsider@test.dev',
  password: 'Password1!',
};
const TEAM_CODES = ['WHCARRY1', 'WHCARRY2'];

let memberJwt: string;
let otherJwt: string;
let outsiderJwt: string;
let teamId: string;
let otherTeamId: string;

type Carried = { ticket: { id: string; title: string }; created: boolean };

/** A ticket in `team` linked to Redmine issue `issueId`, as if linked earlier. */
async function seedCarrier(team: string, issueId: string, extra: Record<string, unknown> = {}) {
  const db = await getDb();
  const _id = new ObjectId();
  await db.collection('tickets').insertOne({
    _id,
    teamId: team,
    title: `Carries ${issueId}`,
    github: '',
    status: 'open',
    createdBy: 'seed',
    assignedTo: [],
    linkedIssue: { source: 'redmine', id: issueId },
    createdAt: new Date(),
    ...extra,
  });
  return _id.toHexString();
}

beforeAll(async () => {
  const db = await getDb();
  await Promise.all([ADMIN, MEMBER, OTHER, OUTSIDER].map((user) => purgeUser(user.email)));
  const [, member, other, outsider] = await Promise.all(
    [ADMIN, MEMBER, OTHER, OUTSIDER].map((user) => createUserAndGetJwt(user)),
  );
  memberJwt = member.jwt;
  otherJwt = other.jwt;
  outsiderJwt = outsider.jwt;
  const idOf = async (email: string) =>
    String((await db.collection('users').findOne({ 'emails.address': email }))!._id);
  const [adminId, memberId, otherId] = await Promise.all([
    idOf(ADMIN.email),
    idOf(MEMBER.email),
    idOf(OTHER.email),
  ]);

  const team = {
    _id: new ObjectId(),
    name: 'WH Carry Team',
    members: [adminId, memberId],
    admins: [adminId],
    code: TEAM_CODES[0],
    isPersonal: false,
    createdAt: new Date(),
  };
  const otherTeam = {
    _id: new ObjectId(),
    name: 'WH Carry Other',
    members: [otherId],
    admins: [otherId],
    code: TEAM_CODES[1],
    isPersonal: false,
    createdAt: new Date(),
  };
  await db.collection('teams').insertMany([team, otherTeam]);
  teamId = team._id.toHexString();
  otherTeamId = otherTeam._id.toHexString();
});

afterEach(async () => {
  const db = await getDb();
  await db.collection('tickets').deleteMany({ teamId: { $in: [teamId, otherTeamId] } });
  await db
    .collection('carry_locks')
    .deleteMany({ _id: { $regex: `^(${teamId}|${otherTeamId}):` } });
});

afterAll(async () => {
  const db = await getDb();
  await db.collection('teams').deleteMany({ code: { $in: TEAM_CODES } });
  await Promise.all([ADMIN, MEMBER, OTHER, OUTSIDER].map((user) => purgeUser(user.email)));
});

describe('tickets.carryIssue (#736)', () => {
  it('refuses someone outside the team', async () => {
    await seedCarrier(teamId, '482');
    const res = await wormhole('tickets.carryIssue', { teamId, issueId: 482 }, outsiderJwt);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not a member/i);
  });

  it('refuses something that is not an issue number', async () => {
    for (const issueId of [0, -3, 'abc', null]) {
      const res = await wormhole('tickets.carryIssue', { teamId, issueId }, memberJwt);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/Redmine issue number/i);
    }
  });

  it("returns the team's ticket already carrying the issue, with no Redmine account", async () => {
    const carrierId = await seedCarrier(teamId, '482');
    const res = await wormhole<Carried>('tickets.carryIssue', { teamId, issueId: 482 }, memberJwt);
    expect(res.ok).toBe(true);
    expect(res.result).toMatchObject({ ticket: { id: carrierId }, created: false });
  });

  it('lands on the oldest ticket when several already carry the issue', async () => {
    const oldest = await seedCarrier(teamId, '482', { createdAt: new Date('2026-01-01') });
    await seedCarrier(teamId, '482', { createdAt: new Date('2026-06-01') });
    const res = await wormhole<Carried>(
      'tickets.carryIssue',
      { teamId, issueId: '482' },
      memberJwt,
    );
    expect(res.result.ticket.id).toBe(oldest);
  });

  it('gives the same ticket to two actions at once', async () => {
    const carrierId = await seedCarrier(teamId, '482');
    const [first, second] = await Promise.all([
      wormhole<Carried>('tickets.carryIssue', { teamId, issueId: 482 }, memberJwt),
      wormhole<Carried>('tickets.carryIssue', { teamId, issueId: 482 }, memberJwt),
    ]);
    expect(first.result.ticket.id).toBe(carrierId);
    expect(second.result.ticket.id).toBe(carrierId);
  });

  it("never lands on another team's ticket, or a deleted one", async () => {
    await seedCarrier(otherTeamId, '482');
    await seedCarrier(teamId, '482', { status: 'deleted' });
    // Nothing to reuse, so it has to create one, which needs Redmine.
    const res = await wormhole('tickets.carryIssue', { teamId, issueId: 482 }, memberJwt);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/connect your Redmine account/i);
  });

  it('is scoped to the team asked for', async () => {
    const otherCarrier = await seedCarrier(otherTeamId, '482');
    const res = await wormhole<Carried>(
      'tickets.carryIssue',
      { teamId: otherTeamId, issueId: 482 },
      otherJwt,
    );
    expect(res.result.ticket.id).toBe(otherCarrier);
  });

  it('says so when someone else is still carrying the same issue', async () => {
    const db = await getDb();
    await db
      .collection('carry_locks')
      .insertOne({ _id: `${teamId}:482`, takenAt: new Date() } as never);
    const res = await wormhole('tickets.carryIssue', { teamId, issueId: 482 }, memberJwt);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/being added already/i);
  });
});
