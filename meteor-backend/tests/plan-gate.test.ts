/**
 * Plan-first clock flow — wormhole REST + DDP integration tests.
 *
 * Covers the `settings.requirePlanForClock` team setting (Milestone 1), the
 * postDate/wrapUpAt post fields (Milestone 2), and the clock-out gate
 * (Milestone 3): gate off → clock in/out unchanged; gate on → clock-out is
 * blocked until today's post has a wrap-up.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createUserAndGetJwt,
  wormhole,
  getDb,
  closeDb,
  purgeUser,
  ObjectId,
  DDPConnection,
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
    createdAt: new Date(),
  };
  await db.collection('teams').insertOne(teamDoc);
  teamId = teamDoc._id.toHexString();

  // DDP session as the member — huddle.createPost/updatePost are DDP-only
  // (they authenticate via this.userId).
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

describe('plan-first clock flow (wormhole)', () => {
  let postId: string;

  it('gate off by default: clock in and out work with no post', async () => {
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
    const res = await wormhole<{ team: { settings: { requirePlanForClock: boolean } } }>(
      'teams.updateSettings',
      { teamId, requirePlanForClock: true },
      adminJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.team.settings.requirePlanForClock).toBe(true);
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

    const res = await wormhole<{ team: { settings: { requirePlanForClock: boolean } } }>(
      'teams.updateSettings',
      { teamId, requirePlanForClock: false },
      adminJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.team.settings.requirePlanForClock).toBe(false);

    const start = await wormhole<{ id: string }>('clock.start', { teamId }, memberJwt);
    expect(start.ok).toBe(true);
    const stop = await wormhole<{ id: string }>('clock.stop', { teamId }, memberJwt);
    expect(stop.ok).toBe(true);
  });
});

describe('drafts (plan-first)', () => {
  let draftId: string;

  it('creates an author-only draft (no postDate, status draft)', async () => {
    // Re-enable the gate for this suite.
    const res = await wormhole(
      'teams.updateSettings',
      { teamId, requirePlanForClock: true },
      adminJwt,
    );
    expect(res.ok).toBe(true);

    const created = (await memberDdp.call('huddle.createPost', [
      { teamId, content: { text: 'Tomorrow: finish drafts milestone.' }, draft: true },
    ])) as { id: string };
    draftId = created.id;
    expect(draftId).toBeTruthy();

    const fetched = await wormhole<{ post: { id: string; status?: string; postDate?: string } }>(
      'huddle.getMyLatestDraft',
      { teamId },
      memberJwt,
    );
    expect(fetched.ok).toBe(true);
    expect(fetched.result.post?.id).toBe(draftId);
    expect(fetched.result.post?.status).toBe('draft');
    expect(fetched.result.post?.postDate).toBeUndefined();
  });

  it('drafts are invisible in the team feed', async () => {
    const feed = (await memberDdp.call('huddle.getPosts', [{ teamId }])) as {
      posts: Array<{ id: string }>;
    };
    expect(feed.posts.some((p) => p.id === draftId)).toBe(false);
  });

  it('a draft does not satisfy the gate', async () => {
    // Start a bare session; a draft alone can't unblock clock-out.
    const start = await wormhole<{ id: string }>('clock.start', { teamId }, memberJwt);
    expect(start.ok).toBe(true);
    const stop = await wormhole('clock.stop', { teamId }, memberJwt);
    expect(stop.ok).toBe(false);
    expect(stop.error).toMatch(/wrap-up/i);
  });

  it('only the author can publish a draft', async () => {
    const adminDdp = new DDPConnection(METEOR_URL.replace('http://', 'ws://') + '/websocket');
    await adminDdp.connect();
    await adminDdp.login(ADMIN.email, ADMIN.password);
    await expect(
      adminDdp.call('huddle.publishPost', [{ postId: draftId, postDate: todayString() }]),
    ).rejects.toThrow(/author/i);
    adminDdp.close();
  });

  it('publishing a draft as the session plan enters the feed and unblocks clock-out', async () => {
    const active = await wormhole<{ id: string }>('clock.activeForUser', {}, memberJwt);
    const clockEventId = active.result.id;

    // Publish the draft, linking it to the active session.
    await memberDdp.call('huddle.publishPost', [
      {
        postId: draftId,
        postDate: todayString(),
        content: { text: 'Today: finish drafts milestone.' },
        clockEventId,
      },
    ]);

    // Now it's the session post (published, linked), but no wrap-up yet.
    const linked = await wormhole<{ post: { id: string; status?: string } }>(
      'huddle.getMyPostForSession',
      { teamId, clockEventId },
      memberJwt,
    );
    expect(linked.ok).toBe(true);
    expect(linked.result.post?.id).toBe(draftId);
    expect(linked.result.post?.status).toBeUndefined();

    const feed = (await memberDdp.call('huddle.getPosts', [{ teamId }])) as {
      posts: Array<{ id: string }>;
    };
    expect(feed.posts.some((p) => p.id === draftId)).toBe(true);

    const noDraft = await wormhole<{ post: null }>('huddle.getMyLatestDraft', { teamId }, memberJwt);
    expect(noDraft.result.post).toBeNull();

    // Wrap up and clock out to close the session opened in the previous test.
    await memberDdp.call('huddle.updatePost', [
      { postId: draftId, content: { text: 'Done. Wrap-up: drafts work.' }, wrapUp: true },
    ]);
    const stop = await wormhole<{ id: string }>('clock.stop', { teamId }, memberJwt);
    expect(stop.ok).toBe(true);
  });
});
