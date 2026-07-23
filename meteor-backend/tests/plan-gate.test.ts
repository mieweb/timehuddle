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

  it('gate on: clock-out is blocked when there is no post for today', async () => {
    const res = await wormhole(
      'clock.stop',
      { teamId, localDate: todayString() },
      memberJwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/wrap-up/i);
  });

  it("creating today's post (no wrap-up yet) still blocks clock-out", async () => {
    const created = (await memberDdp.call('huddle.createPost', [
      {
        teamId,
        content: { text: 'Today I will ship the plan-first flow.' },
        postDate: todayString(),
      },
    ])) as { id: string };
    postId = created.id;
    expect(postId).toBeTruthy();

    const fetched = await wormhole<{ post: { id: string; wrapUpAt: string | null } }>(
      'huddle.getMyPostForDate',
      { teamId, postDate: todayString() },
      memberJwt,
    );
    expect(fetched.ok).toBe(true);
    expect(fetched.result.post?.id).toBe(postId);
    expect(fetched.result.post?.wrapUpAt).toBeNull();

    // No localDate sent — exercises the server-local date fallback.
    const stop = await wormhole('clock.stop', { teamId }, memberJwt);
    expect(stop.ok).toBe(false);
    expect(stop.error).toMatch(/wrap-up/i);
  });

  it('saving a wrap-up edit stamps wrapUpAt and unblocks clock-out', async () => {
    await memberDdp.call('huddle.updatePost', [
      {
        postId,
        content: { text: 'Today I shipped the plan-first flow. Wrap-up: it works.' },
        wrapUp: true,
      },
    ]);

    const fetched = await wormhole<{ post: { wrapUpAt: string | null } }>(
      'huddle.getMyPostForDate',
      { teamId, postDate: todayString() },
      memberJwt,
    );
    expect(fetched.ok).toBe(true);
    expect(fetched.result.post?.wrapUpAt).toBeTruthy();

    const stop = await wormhole<{ id: string; endTime: number }>(
      'clock.stop',
      { teamId, localDate: todayString() },
      memberJwt,
    );
    expect(stop.ok).toBe(true);
    expect(stop.result.endTime).toBeGreaterThan(0);
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
    const forDate = await wormhole<{ post: null }>(
      'huddle.getMyPostForDate',
      { teamId, postDate: todayString() },
      memberJwt,
    );
    expect(forDate.ok).toBe(true);
    expect(forDate.result.post).toBeNull();

    const start = await wormhole<{ id: string }>('clock.start', { teamId }, memberJwt);
    expect(start.ok).toBe(true);
    const stop = await wormhole('clock.stop', { teamId, localDate: todayString() }, memberJwt);
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

  it('publishing stamps postDate, enters the feed, and satisfies the gate', async () => {
    await memberDdp.call('huddle.publishPost', [
      {
        postId: draftId,
        postDate: todayString(),
        content: { text: 'Today: finish drafts milestone.' },
      },
    ]);

    const forDate = await wormhole<{ post: { id: string; status?: string; postDate?: string } }>(
      'huddle.getMyPostForDate',
      { teamId, postDate: todayString() },
      memberJwt,
    );
    expect(forDate.ok).toBe(true);
    expect(forDate.result.post?.id).toBe(draftId);
    expect(forDate.result.post?.status).toBeUndefined();
    expect(forDate.result.post?.postDate).toBe(todayString());

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
    const stop = await wormhole<{ id: string }>(
      'clock.stop',
      { teamId, localDate: todayString() },
      memberJwt,
    );
    expect(stop.ok).toBe(true);
  });
});
