/**
 * The per-team clock — wormhole REST integration tests.
 *
 * A person holds at most one open shift per team (a unique partial index
 * enforces it), may be on the clock in several teams at once, and clocking out
 * of one team ends only that session and the ticket timers running inside it.
 * The startup cleanup that resolves older duplicates is unit tested in
 * open-shift-dedupe.test.ts.
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

const USER = { name: 'Per Team Clock User', email: 'wh-clock-per-team@test.dev', password: 'Password1!' };
const TEAM_CODES = ['WHPTA001', 'WHPTB001', 'WHPTC001'];

type Shift = { id: string; teamId: string; endTime: number | null };

let jwt: string;
let userId: string;
let teamA: string;
let teamB: string;
let teamC: string;
const ticketIn: Record<string, string> = {};

const today = () => new Date().toISOString().split('T')[0];

async function openShifts() {
  const res = await wormhole<Shift[]>('clock.myOpenShifts', {}, jwt);
  expect(res.ok).toBe(true);
  return res.result;
}

async function startTimer(teamOfTicket: string, hint?: string) {
  return wormhole<{ session: { id: string; clockEventId: string | null } | null }>(
    'timers.createEntry',
    {
      ticketId: ticketIn[teamOfTicket],
      date: today(),
      startNow: true,
      notifyAdmins: false,
      ...(hint ? { teamId: hint } : {}),
    },
    jwt,
  );
}

beforeAll(async () => {
  await purgeUser(USER.email);
  jwt = (await createUserAndGetJwt(USER)).jwt;
  const db = await getDb();
  userId = String((await db.collection('users').findOne({ 'emails.address': USER.email }))!._id);

  const ids: string[] = [];
  for (const [i, code] of TEAM_CODES.entries()) {
    const _id = new ObjectId();
    await db.collection('teams').insertOne({
      _id,
      name: `WH Per Team ${'ABC'[i]}`,
      members: [userId],
      admins: [userId],
      code,
      isPersonal: false,
      createdAt: new Date(),
    });
    const teamId = _id.toHexString();
    ids.push(teamId);
    const ticketId = new ObjectId();
    await db.collection('tickets').insertOne({
      _id: ticketId,
      teamId,
      title: `Per team ticket ${'ABC'[i]}`,
      status: 'open',
      priority: 'medium',
      createdBy: userId,
      assignedTo: userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    ticketIn[teamId] = ticketId.toHexString();
  }
  [teamA, teamB, teamC] = ids;
});

afterAll(async () => {
  const db = await getDb();
  await db.collection('teams').deleteMany({ code: { $in: TEAM_CODES } });
  await db.collection('tickets').deleteMany({ teamId: { $in: [teamA, teamB, teamC] } });
  await db.collection('workitems').deleteMany({ userId });
  await db.collection('timers').deleteMany({ userId });
  await db.collection('clockevents').deleteMany({ userId });
  await db.collection('clockbreaks').deleteMany({ userId });
  await purgeUser(USER.email);
  await closeDb();
});

describe('one open shift per person per team', () => {
  it('has the unique partial index on clockevents', async () => {
    const db = await getDb();
    const indexes = await db.collection('clockevents').indexes();
    const index = indexes.find((i) => i.name === 'unique_open_shift_per_team');
    expect(index).toBeDefined();
    expect(index!.key).toEqual({ userId: 1, teamId: 1 });
    expect(index!.unique).toBe(true);
    expect(index!.partialFilterExpression).toEqual({ endTime: null });
  });

  it('two simultaneous clock-ins for one team leave exactly one open shift', async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () => wormhole<Shift>('clock.start', { teamId: teamA }, jwt)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    for (const refused of results.filter((r) => !r.ok)) {
      expect(refused.error).toMatch(/already clocked in/i);
    }

    const db = await getDb();
    expect(
      await db.collection('clockevents').countDocuments({ userId, teamId: teamA, endTime: null }),
    ).toBe(1);
  });

  it('refuses a clock-in while that team’s shift is open, without ending it', async () => {
    const [before] = await openShifts();
    const res = await wormhole('clock.start', { teamId: teamA }, jwt);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/already clocked in/i);
    expect((await openShifts()).map((s) => s.id)).toEqual([before.id]);
  });

  it('the database refuses a second open shift for the same person and team', async () => {
    const db = await getDb();
    await expect(
      db.collection('clockevents').insertOne({
        userId,
        teamId: teamA,
        startTime: Date.now(),
        accumulatedTime: 0,
        endTime: null,
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });
});

describe('several teams on the clock at once', () => {
  let shiftA: Shift;
  let shiftB: Shift;

  it('clocks in to team B while team A’s shift is open', async () => {
    const res = await wormhole<Shift>('clock.start', { teamId: teamB }, jwt);
    expect(res.ok).toBe(true);
    const shifts = await openShifts();
    expect(shifts.map((s) => s.teamId).sort()).toEqual([teamA, teamB].sort());
    shiftA = shifts.find((s) => s.teamId === teamA)!;
    shiftB = shifts.find((s) => s.teamId === teamB)!;
  });

  it('nests a ticket timer under the shift of the ticket’s team', async () => {
    const a = await startTimer(teamA);
    expect(a.ok).toBe(true);
    expect(a.result.session!.clockEventId).toBe(shiftA.id);

    const b = await startTimer(teamB);
    expect(b.ok).toBe(true);
    expect(b.result.session!.clockEventId).toBe(shiftB.id);
  });

  it('never picks an arbitrary shift: a ticket of a team off the clock needs a hint', async () => {
    const ambiguous = await startTimer(teamC);
    expect(ambiguous.ok).toBe(false);
    expect(ambiguous.error).toMatch(/more than one team/i);

    const hinted = await startTimer(teamC, teamA);
    expect(hinted.ok).toBe(true);
    expect(hinted.result.session!.clockEventId).toBe(shiftA.id);
  });

  it('clocking out of team B by session leaves team A’s shift and timer running', async () => {
    const db = await getDb();
    const runningA = await db
      .collection('timers')
      .findOne({ userId, clockEventId: shiftA.id, endTime: null });
    expect(runningA).not.toBeNull();

    // Only one timer runs at a time, so put the running one inside B's shift
    // first and check B's clock-out closes it, then restart A's.
    const b = await startTimer(teamB);
    expect(b.ok).toBe(true);
    const stopB = await wormhole<Shift>('clock.stop', { clockEventId: shiftB.id }, jwt);
    expect(stopB.ok).toBe(true);
    expect(stopB.result.endTime).not.toBeNull();
    expect(await db.collection('timers').findOne({ _id: new ObjectId(b.result.session!.id) }))
      .toMatchObject({ endTime: expect.any(Number) });

    const a = await startTimer(teamA);
    expect(a.ok).toBe(true);
    expect((await openShifts()).map((s) => s.id)).toEqual([shiftA.id]);

    // B's clock-out, repeated, is refused rather than ending A.
    const again = await wormhole('clock.stop', { clockEventId: shiftB.id }, jwt);
    expect(again.ok).toBe(false);

    // Clocking in to B again and out of it leaves A's timer running.
    const reopenB = await wormhole<Shift>('clock.start', { teamId: teamB }, jwt);
    expect(reopenB.ok).toBe(true);
    const stopB2 = await wormhole('clock.stop', { clockEventId: reopenB.result.id, teamId: teamB }, jwt);
    expect(stopB2.ok).toBe(true);
    const stillRunning = await db
      .collection('timers')
      .findOne({ _id: new ObjectId(a.result.session!.id) });
    expect(stillRunning!.endTime).toBeNull();
    expect((await openShifts()).map((s) => s.id)).toEqual([shiftA.id]);
  });

  it('refuses a clockEventId that does not belong to the named team', async () => {
    const res = await wormhole('clock.stop', { clockEventId: shiftA.id, teamId: teamB }, jwt);
    expect(res.ok).toBe(false);
    expect((await openShifts()).map((s) => s.id)).toEqual([shiftA.id]);
  });

  it('refuses a clock-out that names neither a session nor a team', async () => {
    const res = await wormhole('clock.stop', {}, jwt);
    expect(res.ok).toBe(false);
    expect((await openShifts()).map((s) => s.id)).toEqual([shiftA.id]);
  });

  it('records the hours of a shift closed by clock-out', async () => {
    const stopA = await wormhole<Shift & { accumulatedTime: number }>(
      'clock.stop',
      { teamId: teamA },
      jwt,
    );
    expect(stopA.ok).toBe(true);
    expect(stopA.result.accumulatedTime).toBeGreaterThanOrEqual(0);
    expect(await openShifts()).toEqual([]);
    const db = await getDb();
    expect(await db.collection('timers').countDocuments({ userId, endTime: null })).toBe(0);
  });
});

describe('another viewer reads open shifts', () => {
  const STRANGER = { name: 'Per Team Stranger', email: 'wh-clock-per-team-stranger@test.dev', password: 'Password1!' };
  let strangerJwt: string;

  beforeAll(async () => {
    await purgeUser(STRANGER.email);
    strangerJwt = (await createUserAndGetJwt(STRANGER)).jwt;
  });

  afterAll(async () => {
    await purgeUser(STRANGER.email);
  });

  it('finds a shift opened more than a day ago, and hides it from a stranger', async () => {
    const db = await getDb();
    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const { insertedId } = await db.collection('clockevents').insertOne({
      userId,
      teamId: teamC,
      startTime: twoDaysAgo,
      accumulatedTime: 0,
      autoClockoutAgreed: null,
      endTime: null,
    });

    const own = await wormhole<Shift[]>('clock.openShiftsForUser', { userId }, jwt);
    expect(own.ok).toBe(true);
    expect(own.result.map((s) => s.id)).toEqual([insertedId.toHexString()]);

    const stranger = await wormhole('clock.openShiftsForUser', { userId }, strangerJwt);
    expect(stranger.ok).toBe(false);

    const stop = await wormhole('clock.stop', { clockEventId: insertedId.toHexString() }, jwt);
    expect(stop.ok).toBe(true);
  });
});
