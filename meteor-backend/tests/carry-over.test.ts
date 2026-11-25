/**
 * Clock-out carry-over (M5, #887) — wormhole REST tests: ending a session
 * unpins the tickets checked off in its plan and leaves the rest pinned, in
 * order. The plan is M4's session data (`clockevents.planItems`), written
 * straight to the database here.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createUserAndGetJwt, wormhole, getDb, closeDb, purgeUser, ObjectId } from './helpers';

const USER = { name: 'Carry Over User', email: 'wh-carry-over-user@test.dev', password: 'Password1!' };
const TITLE = 'Carry Over Test Ticket';

let jwt: string;
let userId: string;
let teamId: string;
let ids: Record<'a' | 'b' | 'c' | 'd', string>;

/** The board's pinned entries, in pin order, as `source:id`. */
async function pins() {
  const db = await getDb();
  const rows = await db
    .collection('my_board')
    .find({ userId, pinOrder: { $type: 'number' } })
    .sort({ pinOrder: 1 })
    .toArray();
  return rows.map((row) => `${row.sourceId}:${row.ticketId}`);
}

async function clockIn() {
  const res = await wormhole('clock.start', { teamId }, jwt);
  expect(res.ok).toBe(true);
  const db = await getDb();
  return (await db.collection('clockevents').findOne({ userId, teamId, endTime: null }))!._id;
}

beforeAll(async () => {
  await purgeUser(USER.email);
  jwt = (await createUserAndGetJwt(USER)).jwt;
  const db = await getDb();
  userId = String((await db.collection('users').findOne({ 'emails.address': USER.email }))!._id);

  const team = {
    _id: new ObjectId(),
    name: 'WH Carry Over Team',
    members: [userId],
    admins: [userId],
    code: 'WHCARRY1',
    isPersonal: false,
    settings: { requirePlanForClock: false },
    createdAt: new Date(),
  };
  await db.collection('teams').insertOne(team);
  teamId = team._id.toHexString();

  const ticket = (extra: object = {}) => ({
    _id: new ObjectId(),
    teamId,
    title: TITLE,
    status: 'open',
    priority: 'medium',
    createdBy: userId,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...extra,
  });
  // `c` is pinned through the Redmine issue it's linked to (#736).
  const docs = [ticket(), ticket(), ticket({ linkedIssue: { source: 'redmine', id: '4821' } }), ticket()];
  await db.collection('tickets').insertMany(docs);
  const [a, b, c, d] = docs.map((doc) => doc._id.toHexString());
  ids = { a, b, c, d };
});

beforeEach(async () => {
  const db = await getDb();
  await db.collection('my_board').deleteMany({ userId });
  await db.collection('my_board').insertMany(
    [
      { sourceId: 'huddle', ticketId: ids.a },
      { sourceId: 'huddle', ticketId: ids.b },
      { sourceId: 'redmine', ticketId: '4821' },
      { sourceId: 'huddle', ticketId: ids.d },
    ].map((ref, pinOrder) => ({ ...ref, userId, addedAt: new Date(), pinOrder })),
  );
});

afterAll(async () => {
  const db = await getDb();
  await db.collection('my_board').deleteMany({ userId });
  await db.collection('tickets').deleteMany({ title: TITLE });
  await db.collection('workitems').deleteMany({ userId });
  await db.collection('timers').deleteMany({ userId });
  await db.collection('clockevents').deleteMany({ teamId });
  await db.collection('teams').deleteMany({ code: 'WHCARRY1' });
  await purgeUser(USER.email);
  await closeDb();
});

describe('clock-out carry-over', () => {
  it('unpins the checked-off tickets, the running one too; the unchecked ones stay pinned, in order', async () => {
    const db = await getDb();
    const sessionId = await clockIn();
    // `c` is checked off and still being worked on at clock-out: the Clock
    // page asked, and the person checked it off.
    const workItem = { _id: new ObjectId(), userId, source: 'huddle', ticketId: ids.c, teamId };
    await db.collection('workitems').insertOne(workItem);
    await db.collection('timers').insertOne({
      userId,
      workItemId: workItem._id.toHexString(),
      clockEventId: sessionId.toHexString(),
      startTime: Date.now() - 60_000,
      endTime: null,
    });
    await db.collection('clockevents').updateOne(
      { _id: sessionId },
      {
        $set: {
          planItems: [
            { id: 'p1', ticketId: ids.a, checked: true },
            { id: 'p2', ticketId: ids.b, checked: false },
            { id: 'p3', ticketId: ids.c, checked: true },
            { id: 'p4', ticketId: ids.d, checked: false },
            { id: 'p5', text: 'Review notes', checked: true },
          ],
        },
      },
    );

    const res = await wormhole('clock.stop', { teamId }, jwt);
    expect(res.ok).toBe(true);

    expect(await pins()).toEqual([`huddle:${ids.b}`, `huddle:${ids.d}`]);
    // Unpinned, not taken off the board.
    expect(await db.collection('my_board').countDocuments({ userId })).toBe(4);
  });

  it('leaves the pins alone for a session without a plan', async () => {
    await clockIn();
    const before = await pins();

    const res = await wormhole('clock.stop', { teamId }, jwt);
    expect(res.ok).toBe(true);

    expect(await pins()).toEqual(before);
  });
});
