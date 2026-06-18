/**
 * Clock — wormhole REST integration tests.
 *
 * Fixture: USER in a team. Tests clock in/out/pause/resume lifecycle.
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

const USER = { name: 'Clock User', email: 'wh-clock-user@test.dev', password: 'Password1!' };

let jwt: string;
let userId: string;
let teamId: string;

beforeAll(async () => {
  await purgeUser(USER.email);
  const auth = await createUserAndGetJwt(USER);
  jwt = auth.jwt;

  const db = await getDb();
  userId = String((await db.collection('user').findOne({ email: USER.email }))!._id);

  const teamDoc = {
    _id: new ObjectId(),
    name: 'WH Clock Team',
    members: [userId],
    admins: [userId],
    code: 'WHCLOCK1',
    isPersonal: false,
    createdAt: new Date(),
  };
  await db.collection('teams').insertOne(teamDoc);
  teamId = teamDoc._id.toHexString();
});

afterAll(async () => {
  const db = await getDb();
  await db.collection('teams').deleteMany({ code: 'WHCLOCK1' });
  await db.collection('clockevents').deleteMany({ teamId });
  await db.collection('clockbreaks').deleteMany({ teamId });
  await purgeUser(USER.email);
  await closeDb();
});

describe('clock (wormhole)', () => {
  let clockEventId: string;

  it('has no active clock initially', async () => {
    const res = await wormhole<null>('clock.activeForUser', {}, jwt);
    expect(res.ok).toBe(true);
    expect(res.result).toBeNull();
  });

  it('clocks in', async () => {
    const res = await wormhole<{ id: string; userId: string; teamId: string; startTime: number }>(
      'clock.start',
      { teamId },
      jwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.userId).toBe(userId);
    expect(res.result.teamId).toBe(teamId);
    expect(res.result.startTime).toBeGreaterThan(0);
    clockEventId = res.result.id;
  });

  it('shows active clock event', async () => {
    const res = await wormhole<{ id: string }>('clock.activeForUser', {}, jwt);
    expect(res.ok).toBe(true);
    expect(res.result.id).toBe(clockEventId);
  });

  it('gets clock status', async () => {
    const res = await wormhole<{ event: { id: string }; workSeconds: number; isPaused: boolean }>(
      'clock.status',
      { teamId },
      jwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.event.id).toBe(clockEventId);
    expect(res.result.isPaused).toBe(false);
    expect(res.result.workSeconds).toBeGreaterThanOrEqual(0);
  });

  it('pauses the clock', async () => {
    const res = await wormhole<{ id: string }>('clock.pause', { teamId }, jwt);
    expect(res.ok).toBe(true);
  });

  it('resumes the clock', async () => {
    const res = await wormhole<{ id: string }>('clock.resume', { teamId }, jwt);
    expect(res.ok).toBe(true);
  });

  it('clocks out', async () => {
    const res = await wormhole<{ id: string; endTime: number | null }>(
      'clock.stop',
      { teamId },
      jwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.endTime).not.toBeNull();
  });

  it('has no active clock after stop', async () => {
    const res = await wormhole<null>('clock.activeForUser', {}, jwt);
    expect(res.ok).toBe(true);
    expect(res.result).toBeNull();
  });

  it('lists clock events', async () => {
    const res = await wormhole<Array<{ id: string }>>('clock.events', {}, jwt);
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.result)).toBe(true);
    expect(res.result.length).toBeGreaterThanOrEqual(1);
  });
});
