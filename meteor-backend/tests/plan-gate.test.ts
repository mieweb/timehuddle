/**
 * Plan-first clock flow — wormhole REST + DDP integration tests.
 *
 * Covers the `settings.requirePlanForClock` team setting (Milestone 1), the
 * postDate/wrapUpAt post fields (Milestone 2), and the clock-out gate
 * (Milestone 3): gate off → clock in/out unchanged; gate on → clock-out is
 * blocked until today's post has a wrap-up.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import {
  createUserAndGetJwt,
  wormhole,
  getDb,
  closeDb,
  purgeUser,
  ObjectId,
  DDPConnection,
  type SettingValue,
} from './helpers';
import { METEOR_URL } from './setup';

const ADMIN = { name: 'Plan Admin', email: 'wh-plan-admin@test.dev', password: 'Password1!' };
const MEMBER = { name: 'Plan Member', email: 'wh-plan-member@test.dev', password: 'Password1!' };

function todayString(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

let adminJwt: string;
let memberJwt: string;
let memberUserId: string;
let teamId: string;
let memberDdp: DDPConnection;

beforeAll(async () => {
  await purgeUser(ADMIN.email);
  await purgeUser(MEMBER.email);
  const adminAuth = await createUserAndGetJwt(ADMIN);
  const memberAuth = await createUserAndGetJwt(MEMBER);
  adminJwt = adminAuth.jwt;
  memberJwt = memberAuth.jwt;

  const db = await getDb();
  const adminUserId = String(
    (await db.collection('users').findOne({ 'emails.address': ADMIN.email }))!._id,
  );
  memberUserId = String(
    (await db.collection('users').findOne({ 'emails.address': MEMBER.email }))!._id,
  );

  const teamDoc = {
    _id: new ObjectId(),
    name: 'WH Plan Team',
    members: [adminUserId, memberUserId],
    admins: [adminUserId],
    code: 'WHPLAN01',
    isPersonal: false,
    settings: { requirePlanForClock: false },
    createdAt: new Date(),
  };
  await db.collection('teams').insertOne(teamDoc);
  teamId = teamDoc._id.toHexString();

  // DDP session as the member. huddle.createPost/updatePost are reachable over
  // REST too (see huddle-post-rest.test.ts); exercising them over DDP here
  // keeps that transport covered.
  memberDdp = new DDPConnection(METEOR_URL.replace('http://', 'ws://') + '/websocket');
  await memberDdp.connect();
  await memberDdp.login(MEMBER.email, MEMBER.password);
});

afterAll(async () => {
  memberDdp?.close();
  const db = await getDb();
  await db.collection('teams').deleteMany({ code: 'WHPLAN01' });
  await db.collection('clockevents').deleteMany({ teamId });
  await db.collection('clockbreaks').deleteMany({ teamId });
  await db.collection('huddlePosts').deleteMany({ teamId });
  await purgeUser(ADMIN.email);
  await purgeUser(MEMBER.email);
  await closeDb();
});

describe('teams.create default', () => {
  it('creates new teams inheriting the plan requirement, which is on by default', async () => {
    const res = await wormhole<{
      team: { id: string; settings: { requirePlanForClock: SettingValue } };
    }>('teams.create', { name: 'WH Plan Default Team' }, adminJwt);
    expect(res.ok).toBe(true);
    expect(res.result.team.settings.requirePlanForClock).toEqual({
      value: true,
      source: 'system',
      locked: false,
    });

    await wormhole('teams.delete', { teamId: res.result.team.id }, adminJwt);
  });
});

describe('plan-first clock flow (wormhole)', () => {
  let postId: string;

  it('gate off: clock in and out work with no post', async () => {
    const start = await wormhole<{ id: string }>('clock.start', { teamId }, memberJwt);
    expect(start.ok).toBe(true);
    const stop = await wormhole<{ id: string }>('clock.stop', { teamId }, memberJwt);
    expect(stop.ok).toBe(true);
  });

  it('rejects teams.updateSettings from a non-admin member', async () => {
    const res = await wormhole(
      'teams.updateSettings',
      { teamId, requirePlanForClock: true },
      memberJwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/admin/i);
  });

  it('lets a team admin enable requirePlanForClock', async () => {
    const res = await wormhole<{ team: { settings: { requirePlanForClock: SettingValue } } }>(
      'teams.updateSettings',
      { teamId, requirePlanForClock: true },
      adminJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.team.settings.requirePlanForClock.value).toBe(true);
  });

  it('getMyPostForDate returns null before any post exists', async () => {
    const res = await wormhole<{ post: null }>(
      'huddle.getMyPostForDate',
      { teamId, postDate: todayString() },
      memberJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.post).toBeNull();
  });

  it('gate on: clock-in itself is not backend-blocked', async () => {
    const res = await wormhole<{ id: string }>('clock.start', { teamId }, memberJwt);
    expect(res.ok).toBe(true);
  });

  it('gate on: clock-out is blocked when this session has no linked post', async () => {
    const res = await wormhole('clock.stop', { teamId }, memberJwt);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/wrap-up/i);
  });

  it('recovery: a session post created for the active session unblocks clock-out', async () => {
    // The session started bare (previous test). Its active event:
    const active = await wormhole<{ id: string }>('clock.activeForUser', {}, memberJwt);
    expect(active.ok).toBe(true);
    const clockEventId = active.result.id;

    // A plain post for today (no session link) does NOT satisfy the gate.
    await memberDdp.call('huddle.createPost', [
      { teamId, content: { text: 'unrelated update' }, postDate: todayString() },
    ]);
    const stillBlocked = await wormhole('clock.stop', { teamId }, memberJwt);
    expect(stillBlocked.ok).toBe(false);

    // A post linked to this session WITH a wrap-up satisfies it.
    await memberDdp.call('huddle.createPost', [
      {
        teamId,
        content: { text: '**Wrap-up:** recovered session' },
        postDate: todayString(),
        clockEventId,
        wrapUp: true,
      },
    ]);
    const stop = await wormhole<{ id: string; endTime: number }>('clock.stop', { teamId }, memberJwt);
    expect(stop.ok).toBe(true);
    expect(stop.result.endTime).toBeGreaterThan(0);
  });

  it('per-session flow: plan → clock-in links it → wrap-up → clock-out', async () => {
    const db = await getDb();
    await db.collection('huddlePosts').deleteMany({ teamId });

    // 1) Post the plan (published, dated).
    const plan = (await memberDdp.call('huddle.createPost', [
      { teamId, content: { text: 'Session plan: ship per-session gates.' }, postDate: todayString() },
    ])) as { id: string };
    postId = plan.id;

    // 2) Clock in with planPostId → links the plan to the new session.
    const start = await wormhole<{ id: string }>(
      'clock.start',
      { teamId, planPostId: postId },
      memberJwt,
    );
    expect(start.ok).toBe(true);
    const clockEventId = start.result.id;

    const linked = await wormhole<{ post: { id: string; clockEventId?: string } }>(
      'huddle.getMyPostForSession',
      { teamId, clockEventId },
      memberJwt,
    );
    expect(linked.ok).toBe(true);
    expect(linked.result.post?.id).toBe(postId);

    // 3) No wrap-up yet → clock-out blocked.
    const blocked = await wormhole('clock.stop', { teamId }, memberJwt);
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/wrap-up/i);

    // 4) Wrap up the session post → clock-out works.
    await memberDdp.call('huddle.updatePost', [
      { postId, content: { text: 'Session plan. Wrap-up: shipped.' }, wrapUp: true },
    ]);
    const stop = await wormhole<{ id: string; endTime: number }>('clock.stop', { teamId }, memberJwt);
    expect(stop.ok).toBe(true);
    expect(stop.result.endTime).toBeGreaterThan(0);
  });

  it('second clock-in of the day needs its OWN plan (per session, not per day)', async () => {
    // Today's post from the previous session already exists and is wrapped up,
    // but a fresh session's post is a different one.
    const start = await wormhole<{ id: string }>('clock.start', { teamId }, memberJwt);
    expect(start.ok).toBe(true);
    // No post linked to this new session → clock-out blocked even though an
    // earlier wrapped-up post exists for today.
    const blocked = await wormhole('clock.stop', { teamId }, memberJwt);
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/wrap-up/i);

    // Recover so the suite leaves no open session.
    const active = await wormhole<{ id: string }>('clock.activeForUser', {}, memberJwt);
    await memberDdp.call('huddle.createPost', [
      {
        teamId,
        content: { text: '**Wrap-up:** second session' },
        postDate: todayString(),
        clockEventId: active.result.id,
        wrapUp: true,
      },
    ]);
    const stop = await wormhole('clock.stop', { teamId }, memberJwt);
    expect(stop.ok).toBe(true);
  });

  it('gate turned back off: clock in/out works again without a post', async () => {
    const db = await getDb();
    await db.collection('huddlePosts').deleteMany({ teamId });

    const res = await wormhole<{ team: { settings: { requirePlanForClock: SettingValue } } }>(
      'teams.updateSettings',
      { teamId, requirePlanForClock: false },
      adminJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.team.settings.requirePlanForClock.value).toBe(false);

    const start = await wormhole<{ id: string }>('clock.start', { teamId }, memberJwt);
    expect(start.ok).toBe(true);
    const stop = await wormhole<{ id: string }>('clock.stop', { teamId }, memberJwt);
    expect(stop.ok).toBe(true);
  });
});

describe('plan requirement from the hierarchy (wormhole)', () => {
  const orgId = new ObjectId();
  const inheritingTeamId = new ObjectId();
  const ownFalseTeamId = new ObjectId();
  const personalTeamId = new ObjectId();
  const teamIds = [inheritingTeamId, ownFalseTeamId, personalTeamId];

  async function setOrg(settings: Record<string, boolean>, settingsLocks: Record<string, true> = {}) {
    const db = await getDb();
    await db
      .collection('organizations')
      .updateOne({ _id: orgId }, { $set: { settings, settingsLocks } });
  }

  async function clockInThenOut(team: ObjectId) {
    const id = team.toHexString();
    const start = await wormhole('clock.start', { teamId: id }, memberJwt);
    expect(start.ok).toBe(true);
    return wormhole('clock.stop', { teamId: id }, memberJwt);
  }

  beforeAll(async () => {
    const db = await getDb();
    const now = new Date();
    await db.collection('organizations').insertOne({
      _id: orgId,
      name: 'WH Plan Hierarchy Org',
      slug: `wh-plan-hierarchy-${orgId.toHexString()}`,
      owners: [],
      admins: [],
      settings: {},
      settingsLocks: {},
      createdAt: now,
      updatedAt: now,
    });
    const base = {
      orgId: orgId.toHexString(),
      members: [memberUserId],
      admins: [],
      createdAt: now,
    };
    await db.collection('teams').insertMany([
      { ...base, _id: inheritingTeamId, name: 'WH Plan Inheriting', code: 'WHPLANH1', isPersonal: false },
      {
        ...base,
        _id: ownFalseTeamId,
        name: 'WH Plan Migrated',
        code: 'WHPLANH2',
        isPersonal: false,
        settings: { requirePlanForClock: false },
      },
      { ...base, _id: personalTeamId, name: 'WH Plan Personal', code: 'WHPLANH3', isPersonal: true },
    ]);
  });

  afterEach(async () => {
    const db = await getDb();
    await db
      .collection('clockevents')
      .deleteMany({ teamId: { $in: teamIds.map((id) => id.toHexString()) } });
  });

  afterAll(async () => {
    const db = await getDb();
    await db.collection('teams').deleteMany({ _id: { $in: teamIds } });
    await db.collection('organizations').deleteMany({ _id: orgId });
  });

  it('blocks clock-out when the requirement is inherited from the org', async () => {
    await setOrg({ requirePlanForClock: true });
    const stop = await clockInThenOut(inheritingTeamId);
    expect(stop.ok).toBe(false);
    expect(stop.error).toMatch(/wrap-up/i);
  });

  it('blocks clock-out on the system default when nothing is set above', async () => {
    await setOrg({});
    const stop = await clockInThenOut(inheritingTeamId);
    expect(stop.ok).toBe(false);
  });

  it('lets a team clock out when the org default is off', async () => {
    await setOrg({ requirePlanForClock: false });
    const stop = await clockInThenOut(inheritingTeamId);
    expect(stop.ok).toBe(true);
  });

  it('blocks clock-out when the org locked the requirement over a team value of false', async () => {
    await setOrg({ requirePlanForClock: true }, { requirePlanForClock: true });
    const stop = await clockInThenOut(ownFalseTeamId);
    expect(stop.ok).toBe(false);
    expect(stop.error).toMatch(/wrap-up/i);
  });

  it('keeps a migrated team (explicit false) ungated under an unlocked org default', async () => {
    await setOrg({ requirePlanForClock: true });
    const stop = await clockInThenOut(ownFalseTeamId);
    expect(stop.ok).toBe(true);
  });

  it('never blocks a Personal team, even under a locked org requirement', async () => {
    await setOrg({ requirePlanForClock: true }, { requirePlanForClock: true });
    const stop = await clockInThenOut(personalTeamId);
    expect(stop.ok).toBe(true);
  });
});
