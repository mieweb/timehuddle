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
  it('adds a Huddle ticket the caller can see, once', async () => {
    const refs = [
      { sourceId: 'huddle', ticketId: ownTicketId },
      { sourceId: 'huddle', ticketId: ownTicketId },
    ];
    const res = await add(refs);
    expect(res.ok).toBe(true);
    expect(res.result.addedCount).toBe(1);
    expect(await add(refs)).toMatchObject({ ok: true });
    expect(await boardKeys()).toEqual([`huddle:${ownTicketId}`]);
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
    // A Redmine issue goes on as the ticket carrying it (#736).
    ['a bare Redmine issue', [{ sourceId: 'redmine', ticketId: '42' }]],
    ['more refs than a board holds', Array.from({ length: 501 }, () => ({ sourceId: 'huddle', ticketId: ownTicketId }))],
  ])('refuses %s', async (_label, refs) => {
    const before = await boardKeys();
    expect((await add(refs)).ok).toBe(false);
    expect(await boardKeys()).toEqual(before);
  });

  it('refuses an add that would take the board past its limit', async () => {
    const db = await getDb();
    await db.collection('my_board').deleteMany({ userId });
    await db.collection('my_board').insertMany(
      Array.from({ length: 500 }, (_, i) => ({
        userId,
        sourceId: 'huddle',
        ticketId: new ObjectId().toHexString(),
        addedAt: new Date(i),
      })),
    );
    try {
      const res = await add([{ sourceId: 'huddle', ticketId: ownTicketId }]);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/at most 500/i);
    } finally {
      await db.collection('my_board').deleteMany({ userId });
    }
  });
});

describe('myBoard pins', () => {
  const ref = (ticketId: string) => ({ sourceId: 'huddle', ticketId });
  const call = (method: string, params: unknown) => wormhole<unknown>(method, params, jwt);
  /** The pinned keys in pin order. */
  const pins = async () => {
    const res = await wormhole<{ entries: { sourceId: string; ticketId: string; pinOrder?: number }[] }>(
      'myBoard.list',
      {},
      jwt,
    );
    expect(res.ok).toBe(true);
    return res.result.entries
      .filter((e) => typeof e.pinOrder === 'number')
      .sort((a, b) => a.pinOrder! - b.pinOrder!)
      .map((e) => e.ticketId);
  };

  let a: string;
  let b: string;
  let c: string;

  beforeAll(async () => {
    const db = await getDb();
    await db.collection('my_board').deleteMany({ userId });
    // Board rows only: the pin methods never look at the ticket behind one.
    [a, b, c] = [1, 2, 3].map(() => new ObjectId().toHexString());
    await db.collection('my_board').insertMany(
      [a, b, c].map((ticketId) => ({ userId, sourceId: 'huddle', ticketId, addedAt: new Date() })),
    );
  });

  it('pins after the pins already there, and leaves a re-pin where it is', async () => {
    expect((await call('myBoard.pin', { ref: ref(b) })).ok).toBe(true);
    expect((await call('myBoard.pin', { ref: ref(a) })).ok).toBe(true);
    expect((await call('myBoard.pin', { ref: ref(b) })).ok).toBe(true);
    expect(await pins()).toEqual([b, a]);
  });

  it('refuses to pin a ticket that is not on the board', async () => {
    const res = await call('myBoard.pin', { ref: ref(new ObjectId().toHexString()) });
    expect(res.ok).toBe(false);
  });

  it('sets the pins in order, unpinning the rest and skipping what is off the board', async () => {
    await call('myBoard.pin', { ref: ref(a) });
    const gone = new ObjectId().toHexString();
    expect((await call('myBoard.setPins', { refs: [ref(c), ref(gone), ref(b)] })).ok).toBe(true);
    expect(await pins()).toEqual([c, b]);
    expect((await call('myBoard.setPins', { refs: [ref(a), ref(a)] })).ok).toBe(false);
    expect(await pins()).toEqual([c, b]);
    expect((await call('myBoard.setPins', { refs: [ref(b), ref(a), ref(c)] })).ok).toBe(true);
    expect(await pins()).toEqual([b, a, c]);
  });

  it('unpins, keeping the ticket on the board', async () => {
    expect((await call('myBoard.unpin', { ref: ref(a) })).ok).toBe(true);
    expect(await pins()).toEqual([b, c]);
    expect(await boardKeys()).toContain(`huddle:${a}`);
  });

  it('takes the pin away with the board entry', async () => {
    expect((await call('myBoard.removeMany', { refs: [ref(b)] })).ok).toBe(true);
    expect(await pins()).toEqual([c]);
  });
});
