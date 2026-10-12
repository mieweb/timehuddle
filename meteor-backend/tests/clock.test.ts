/**
 * Clock — wormhole REST integration tests.
 *
 * Fixture: USER in a team. Tests clock in/out/pause/resume lifecycle.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createUserAndGetJwt, wormhole, getDb, closeDb, purgeUser, ObjectId } from './helpers';

const USER = { name: 'Clock User', email: 'wh-clock-user@test.dev', password: 'Password1!' };

let jwt: string;
let userId: string;
let teamId: string;

beforeAll(async () => {
  await purgeUser(USER.email);
  const auth = await createUserAndGetJwt(USER);
  jwt = auth.jwt;

  const db = await getDb();
  userId = String((await db.collection('users').findOne({ 'emails.address': USER.email }))!._id);

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

  it('narrows clock events to one team, completed only, newest first, up to a limit', async () => {
    const db = await getDb();
    const otherTeamId = new ObjectId().toHexString();
    const hour = 60 * 60 * 1000;
    const base = Date.now() - 48 * hour;
    await db.collection('clockevents').insertMany([
      { userId, teamId, startTime: base, endTime: base + hour, accumulatedTime: 0 },
      { userId, teamId, startTime: base + 2 * hour, endTime: base + 3 * hour, accumulatedTime: 0 },
      {
        userId,
        teamId: otherTeamId,
        startTime: base + 4 * hour,
        endTime: base + 5 * hour,
        accumulatedTime: 0,
      },
      { userId, teamId, startTime: base + 6 * hour, endTime: null, accumulatedTime: 0 },
    ]);
    try {
      const res = await wormhole<
        Array<{ teamId: string; startTime: number; endTime: number | null }>
      >('clock.events', { teamId, completed: true, limit: 2 }, jwt);
      expect(res.ok).toBe(true);
      expect(res.result).toHaveLength(2);
      expect(res.result.every((e) => e.teamId === teamId && e.endTime !== null)).toBe(true);
      expect(res.result[0].startTime).toBeGreaterThan(res.result[1].startTime);

      const badLimit = await wormhole('clock.events', { limit: 0 }, jwt);
      expect(badLimit.ok).toBe(false);
    } finally {
      await db.collection('clockevents').deleteMany({ userId, teamId: otherTeamId });
      await db.collection('clockevents').deleteMany({ userId, teamId, endTime: null });
    }
  });

  describe('createManual', () => {
    const oneHour = 60 * 60 * 1000;
    let manualStart: number;
    let manualEnd: number;

    it('creates a manual clock entry', async () => {
      manualEnd = Date.now() - oneHour;
      manualStart = manualEnd - oneHour;
      const res = await wormhole<{ id: string; startTime: number; endTime: number }>(
        'clock.createManual',
        { teamId, startTime: manualStart, endTime: manualEnd },
        jwt,
      );
      expect(res.ok).toBe(true);
      expect(res.result.startTime).toBe(manualStart);
      expect(res.result.endTime).toBe(manualEnd);
    });

    it('rejects overlapping manual entry', async () => {
      const res = await wormhole(
        'clock.createManual',
        { teamId, startTime: manualStart + 1000, endTime: manualEnd - 1000 },
        jwt,
      );
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/overlap/i);
    });
  });

  describe('teamStatus', () => {
    // Dashboard links members to /app/profile/:username, falling back to the raw
    // Meteor userId when no username is set — teamStatus must expose username
    // so that fallback path isn't the only one ever exercised.
    it("includes each member's username so the dashboard can link to their profile", async () => {
      const claim = await wormhole<{ username: string }>(
        'users.claimUsername',
        { username: 'whclockstatususer' },
        jwt,
      );
      expect(claim.ok).toBe(true);

      const res = await wormhole<{
        members: Array<{ userId: string; username: string | null }>;
      }>('clock.teamStatus', { teamId }, jwt);
      expect(res.ok).toBe(true);

      const me = res.result.members.find((m) => m.userId === userId);
      expect(me).toBeDefined();
      expect(me!.username).toBe('whclockstatususer');
    });
  });
});
