/**
 * My Board — wormhole REST tests for what `myBoard.addMany` accepts.
 *
 * The board stores identity only, so the method is the one place that decides
 * which references may be written at all.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createUserAndGetJwt, wormhole, getDb, closeDb, purgeUser, ObjectId } from './helpers';

const USER = { name: 'Board User', email: 'wh-board-user@test.dev', password: 'Password1!' };

let jwt: string;
let userId: string;
let ownTicketId: string;
let otherTicketId: string;

const add = (refs: unknown) => wormhole<{ addedCount: number }>('myBoard.addMany', { refs }, jwt);

const boardKeys = async () => {
  const res = await wormhole<{ entries: { sourceId: string; ticketId: string }[] }>('myBoard.list', {}, jwt);
  expect(res.ok).toBe(true);
  return res.result.entries.map((e) => `${e.sourceId}:${e.ticketId}`).sort();
};

beforeAll(async () => {
  await purgeUser(USER.email);
  jwt = (await createUserAndGetJwt(USER)).jwt;

  const db = await getDb();
  userId = String((await db.collection('users').findOne({ 'emails.address': USER.email }))!._id);
  await db.collection('my_board').deleteMany({ userId });

  const team = (code: string, members: string[]) => ({
    _id: new ObjectId(),
    name: `WH Board Team ${code}`,
    members,
    admins: [],
    code,
    isPersonal: false,
    createdAt: new Date(),
  });
  const ownTeam = team('WHBOARD1', [userId]);
  const otherTeam = team('WHBOARD2', []);
  await db.collection('teams').insertMany([ownTeam, otherTeam]);

  const ticket = (teamId: string) => ({
    _id: new ObjectId(),
    teamId,
    title: 'Board Test Ticket',
    status: 'open',
    priority: 'medium',
    createdBy: userId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const own = ticket(ownTeam._id.toHexString());
  const other = ticket(otherTeam._id.toHexString());
  await db.collection('tickets').insertMany([own, other]);
  ownTicketId = own._id.toHexString();
  otherTicketId = other._id.toHexString();
});

afterAll(async () => {
  const db = await getDb();
  await db.collection('my_board').deleteMany({ userId });
  await db.collection('tickets').deleteMany({ title: 'Board Test Ticket' });
  await db.collection('teams').deleteMany({ code: { $in: ['WHBOARD1', 'WHBOARD2'] } });
  await purgeUser(USER.email);
  await closeDb();
});

describe('myBoard.addMany', () => {
  it('adds a Huddle ticket the caller can see and a Redmine issue, once each', async () => {
    const refs = [
      { sourceId: 'huddle', ticketId: ownTicketId },
      { sourceId: 'redmine', ticketId: '42' },
      { sourceId: 'redmine', ticketId: '42' },
    ];
    const res = await add(refs);
    expect(res.ok).toBe(true);
    expect(res.result.addedCount).toBe(2);
    expect(await add(refs)).toMatchObject({ ok: true });
    expect(await boardKeys()).toEqual([`huddle:${ownTicketId}`, 'redmine:42'].sort());
  });

  it('skips a Huddle ticket in a team the caller is not in', async () => {
    const res = await add([{ sourceId: 'huddle', ticketId: otherTicketId }]);
    expect(res.ok).toBe(true);
    expect(res.result.addedCount).toBe(0);
    expect(await boardKeys()).not.toContain(`huddle:${otherTicketId}`);
  });

  it.each([
    ['an unknown source', [{ sourceId: 'jira', ticketId: '42' }]],
    ['a Huddle id that is not an ObjectId', [{ sourceId: 'huddle', ticketId: 'nope' }]],
    ['a Redmine id that is not a positive integer', [{ sourceId: 'redmine', ticketId: '-1' }]],
    ['more refs than a board holds', Array.from({ length: 501 }, (_, i) => ({ sourceId: 'redmine', ticketId: String(i + 1) }))],
  ])('refuses %s', async (_label, refs) => {
    const before = await boardKeys();
    expect((await add(refs)).ok).toBe(false);
    expect(await boardKeys()).toEqual(before);
  });

  it('refuses an add that would take the board past its limit', async () => {
    const refs = Array.from({ length: 500 }, (_, i) => ({ sourceId: 'redmine', ticketId: String(i + 1000) }));
    const before = await boardKeys();
    expect((await add(refs)).ok).toBe(false);
    expect(await boardKeys()).toEqual(before);
  });
});
