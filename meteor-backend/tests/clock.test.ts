/**
 * Clock — wormhole REST integration tests.
 *
 * Fixture: USER in a team. Tests clock in/out/pause/resume lifecycle.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createUserAndGetJwt, wormhole, getDb, closeDb, purgeUser, ObjectId } from './helpers';
import { getLocalDayBoundary } from '@timehuddle/date-tz';

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

  describe('per-employee timezone attribution', () => {
    // A distributed team (e.g. Fort Wayne HQ + an India-based teammate) must
    // not have "today"/"working days" bucketed by one shared clock — see
    // packages/date-tz. This seeds two teammates in Asia/Kolkata (IST) and
    // America/New_York (ET) — zones whose "today" boundaries, at any given
    // real instant, are many hours apart — and places a shift one minute
    // after whichever of the two zones' "today" started *later* is wrong;
    // instead it places the shift one minute after whichever started
    // *earlier* (computed dynamically, since which zone that is flips over
    // the course of a day), which is always still hours away from the other
    // zone's boundary. A hardcoded-UTC or single-shared-clock implementation
    // would attribute this shift to the same day for both users; per-employee
    // resolution must not.
    const SECOND_USER = {
      name: 'Clock User TZ',
      email: 'wh-clock-user-tz@test.dev',
      password: 'Password1!',
    };
    let secondJwt: string;
    let secondUserId: string;
    let tzTeamId: string;
    let seededEventId: string;

    const now = Date.now();
    const istBoundary = getLocalDayBoundary(now, 'Asia/Kolkata');
    const etBoundary = getLocalDayBoundary(now, 'America/New_York');
    const istIsEarlier = istBoundary.startMs <= etBoundary.startMs;
    const earlierStartMs = istIsEarlier ? istBoundary.startMs : etBoundary.startMs;
    const laterStartMs = istIsEarlier ? etBoundary.startMs : istBoundary.startMs;
    const shiftStartMs = earlierStartMs + 60 * 1000;
    const shiftEndMs = shiftStartMs + 60 * 60 * 1000;

    beforeAll(async () => {
      await purgeUser(SECOND_USER.email);
      const auth = await createUserAndGetJwt(SECOND_USER);
      secondJwt = auth.jwt;

      const db = await getDb();
      secondUserId = String(
        (await db.collection('users').findOne({ 'emails.address': SECOND_USER.email }))!._id,
      );
      await db
        .collection('users')
        .updateOne(
          { 'emails.address': SECOND_USER.email },
          { $set: { timezone: 'America/New_York' } },
        );
      await db
        .collection('users')
        .updateOne({ 'emails.address': USER.email }, { $set: { timezone: 'Asia/Kolkata' } });

      const teamDoc = {
        _id: new ObjectId(),
        name: 'WH Clock TZ Team',
        members: [userId, secondUserId],
        admins: [userId],
        code: 'WHCLOCKTZ',
        isPersonal: false,
        createdAt: new Date(),
      };
      await db.collection('teams').insertOne(teamDoc);
      tzTeamId = teamDoc._id.toHexString();

      const eventDoc = {
        _id: new ObjectId(),
        userId: earlierOwnerId(),
        teamId: tzTeamId,
        startTime: shiftStartMs,
        endTime: shiftEndMs,
        accumulatedTime: Math.floor((shiftEndMs - shiftStartMs) / 1000),
      };
      await db.collection('clockevents').insertOne(eventDoc);
      seededEventId = eventDoc._id.toHexString();
    });

    afterAll(async () => {
      const db = await getDb();
      await db.collection('teams').deleteMany({ code: 'WHCLOCKTZ' });
      await db.collection('clockevents').deleteOne({ _id: new ObjectId(seededEventId) });
      await db
        .collection('users')
        .updateOne({ 'emails.address': USER.email }, { $unset: { timezone: '' } });
      await purgeUser(SECOND_USER.email);
    });

    // userId/secondUserId are only assigned once their respective beforeAll
    // hooks run, so these are read lazily rather than captured at describe-body
    // eval time.
    function earlierOwnerId() {
      return istIsEarlier ? userId : secondUserId;
    }
    function laterOwnerId() {
      return istIsEarlier ? secondUserId : userId;
    }

    it("counts the seeded shift toward its owner's today, not a shared clock", async () => {
      // Guards the test's own premise: the seeded shift must actually fall
      // before the other zone's "today" has started.
      expect(shiftEndMs).toBeLessThan(laterStartMs);

      const res = await wormhole<{
        members: Array<{ userId: string; todaySeconds: number }>;
      }>('clock.teamStatus', { teamId: tzTeamId }, secondJwt);
      expect(res.ok).toBe(true);

      const owner = res.result.members.find((m) => m.userId === earlierOwnerId());
      const other = res.result.members.find((m) => m.userId === laterOwnerId());
      expect(owner).toBeDefined();
      expect(other).toBeDefined();
      // Shift is "today" for its owner, in their own saved timezone.
      expect(owner!.todaySeconds).toBeGreaterThanOrEqual(3599);
      // The same instant is still the previous day for the other teammate,
      // whose timezone rolls into "today" later — and who has no events of
      // their own.
      expect(other!.todaySeconds).toBe(0);
    });

    it("buckets timesheet workingDays by the requester's own timezone", async () => {
      // Narrow window around just the seeded event, so it isn't muddled by
      // this file's other fixtures (clock in/out, createManual), which use
      // real current-time timestamps of their own.
      const windowStart = shiftStartMs - 60 * 1000;
      const windowEnd = shiftEndMs + 60 * 1000;
      const ownerTz = istIsEarlier ? 'Asia/Kolkata' : 'America/New_York';
      const ownerJwt = istIsEarlier ? jwt : secondJwt;
      const res = await wormhole<{
        summary: { workingDays: number };
      }>(
        'clock.timesheet',
        { userId: earlierOwnerId(), startMs: windowStart, endMs: windowEnd, tz: ownerTz },
        ownerJwt,
      );
      expect(res.ok).toBe(true);
      // The whole shift falls on one calendar day in the owner's own timezone.
      expect(res.result.summary.workingDays).toBe(1);
    });
  });
});
