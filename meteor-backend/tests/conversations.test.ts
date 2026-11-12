/**
 * Huddle conversation topics (#866) — every post joins a checked conversation,
 * and a workday runs from one huddle start to the next.
 *
 * Covers plan milestones M1–M2 and races R1, R2, R3, R5, R7, R9, R11.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createUserAndGetJwt, wormhole, getDb, closeDb, purgeUser, ObjectId } from './helpers';
import { METEOR_URL } from './setup';

const AUTHOR = { name: 'Topic Author', email: 'conv-author@test.dev', password: 'Password1!' };
const TEAM_CODE = 'CONV0001';

let authorJwt: string;
let authorUserId: string;
let teamId: string;

/** Today's date in UTC — always within a day of the server's, as startWorkday requires. */
const today = () => new Date().toISOString().slice(0, 10);
const shiftDay = (dateKey: string, days: number) =>
  new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);

async function createPost(params: Record<string, unknown> = {}) {
  return wormhole<{ id: string }>(
    'huddle.createPost',
    { teamId, content: { text: 'A post', mentions: [] }, postDate: today(), ...params },
    authorJwt,
  );
}

async function storedPost(id: string) {
  const db = await getDb();
  return (await db.collection('huddlePosts').findOne({ _id: new ObjectId(id) }))!;
}

async function startWorkday(dateKey = today()) {
  return wormhole<{ id: string; dateKey: string; startedBy: string | null; closedAt: string | null }>(
    'huddle.startWorkday',
    { teamId, dateKey },
    authorJwt,
  );
}

async function openWorkdays() {
  const db = await getDb();
  return db.collection('huddleConversations').find({ teamId, open: true }).toArray();
}

beforeAll(async () => {
  await purgeUser(AUTHOR.email);
  authorJwt = (await createUserAndGetJwt(AUTHOR)).jwt;
  const db = await getDb();
  authorUserId = String((await db.collection('users').findOne({ 'emails.address': AUTHOR.email }))!._id);
  const teamDoc = {
    _id: new ObjectId(),
    name: 'Topic Team',
    members: [authorUserId],
    admins: [authorUserId],
    code: TEAM_CODE,
    isPersonal: false,
    createdAt: new Date(),
  };
  await db.collection('teams').insertOne(teamDoc);
  teamId = teamDoc._id.toHexString();
});

// Each test starts with no conversations and no posts in the team.
beforeEach(async () => {
  const db = await getDb();
  await db.collection('huddlePosts').deleteMany({ teamId });
  await db.collection('huddleConversations').deleteMany({ teamId });
});

afterAll(async () => {
  const db = await getDb();
  await db.collection('teams').deleteMany({ code: TEAM_CODE });
  await db.collection('huddlePosts').deleteMany({ teamId });
  await db.collection('huddleConversations').deleteMany({ teamId });
  await purgeUser(AUTHOR.email);
  await closeDb();
});

describe('every post belongs to a conversation', () => {
  it('opens a workday for the first post when none is open, then reuses it', async () => {
    const first = await createPost();
    expect(first.ok).toBe(true);
    const second = await createPost();
    const a = await storedPost(first.result.id);
    const b = await storedPost(second.result.id);
    expect(a.conversationId).toMatch(/^[a-f0-9]{24}$/);
    expect(b.conversationId).toBe(a.conversationId);

    const open = await openWorkdays();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ kind: 'workday', dateKey: today(), startedBy: null });
  });

  it('returns the conversation id in the feed', async () => {
    const res = await createPost();
    const post = await storedPost(res.result.id);
    const feed = await wormhole<{ posts: { id: string; conversationId?: string }[] }>(
      'huddle.getPosts',
      { teamId, since: new Date(Date.now() - 864e5).toISOString() },
      authorJwt,
    );
    expect(feed.ok).toBe(true);
    expect(feed.result.posts.find((p) => p.id === res.result.id)?.conversationId).toBe(post.conversationId);
  });

  it('reopens a legacy day instead of making a second thread for the same date', async () => {
    const db = await getDb();
    const legacyId = new ObjectId();
    await db.collection('huddleConversations').insertOne({
      _id: legacyId,
      teamId,
      kind: 'workday',
      legacy: true,
      dateKey: today(),
      startedAt: null,
      closedAt: new Date(),
    });
    const res = await createPost();
    expect((await storedPost(res.result.id)).conversationId).toBe(legacyId.toHexString());
    expect(await db.collection('huddleConversations').countDocuments({ teamId, dateKey: today() })).toBe(1);
  });
});

describe('workdays run from one huddle start to the next', () => {
  it('a post before the next huddle joins the previous workday, whatever the calendar says (row 1)', async () => {
    const yesterday = shiftDay(today(), -1);
    const started = await startWorkday(yesterday);
    expect(started.ok).toBe(true);
    // Posted "today" (a new calendar day), but nobody has started today's huddle.
    const res = await createPost({ postDate: today() });
    expect((await storedPost(res.result.id)).conversationId).toBe(started.result.id);
  });

  it("starting the next huddle closes the previous workday and opens one for the starter's date", async () => {
    const first = await startWorkday(shiftDay(today(), -1));
    const second = await startWorkday(today());
    expect(second.ok).toBe(true);
    expect(second.result.id).not.toBe(first.result.id);
    expect(second.result).toMatchObject({ dateKey: today(), startedBy: authorUserId, closedAt: null });

    const db = await getDb();
    const previous = await db.collection('huddleConversations').findOne({ _id: new ObjectId(first.result.id) });
    expect(previous!.closedAt).toBeTruthy();
    expect(previous!.open).toBeUndefined();
    expect(await openWorkdays()).toHaveLength(1);
  });

  it('starting twice on the same day changes nothing (row 2)', async () => {
    const first = await startWorkday();
    const again = await startWorkday();
    expect(again.result.id).toBe(first.result.id);
    expect(await openWorkdays()).toHaveLength(1);
  });

  it('two people starting at the same moment end with one open workday (R1)', async () => {
    await startWorkday(shiftDay(today(), -1));
    const results = await Promise.all([startWorkday(), startWorkday(), startWorkday()]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(new Set(results.map((r) => r.result.id)).size).toBe(1);
    expect(await openWorkdays()).toHaveLength(1);
  });

  it('posts racing with no workday open end with one workday (R3)', async () => {
    const results = await Promise.all([createPost(), createPost(), createPost(), createPost()]);
    expect(results.every((r) => r.ok)).toBe(true);
    const ids = await Promise.all(results.map(async (r) => (await storedPost(r.result.id)).conversationId));
    expect(new Set(ids).size).toBe(1);
    expect(await openWorkdays()).toHaveLength(1);
  });

  it('posts racing a huddle start end in the old or the new workday, with one open (R2)', async () => {
    const old = await startWorkday(shiftDay(today(), -1));
    // Posts sent from a device whose date is still yesterday, so one that lands
    // between the close and the open would open a workday dated yesterday.
    const [started, ...posts] = await Promise.all([
      startWorkday(today()),
      ...Array.from({ length: 6 }, () => createPost({ postDate: shiftDay(today(), -1) })),
    ]);
    expect(started.ok).toBe(true);
    expect(posts.every((p) => p.ok)).toBe(true);

    const open = await openWorkdays();
    expect(open).toHaveLength(1);
    // Whoever opened it, the open workday is the starter's: their date, their name.
    expect(open[0]).toMatchObject({ dateKey: today(), startedBy: authorUserId });
    expect(started.result.id).toBe(open[0]._id.toHexString());
    for (const p of posts) {
      expect([old.result.id, started.result.id]).toContain((await storedPost(p.result.id)).conversationId);
    }
  });

  it("refuses a dateKey that isn't a nearby real date, or is before the open workday (R9)", async () => {
    await startWorkday(today());
    for (const dateKey of ['Nov 12', '2026-02-30', shiftDay(today(), -5), shiftDay(today(), -1)]) {
      const res = await startWorkday(dateKey);
      expect(res.ok).toBe(false);
    }
    expect(await openWorkdays()).toHaveLength(1);
  });

  it('only team members can start the huddle', async () => {
    const outsider = await createUserAndGetJwt({
      name: 'Topic Outsider',
      email: 'conv-outsider@test.dev',
      password: 'Password1!',
    });
    const res = await wormhole('huddle.startWorkday', { teamId, dateKey: today() }, outsider.jwt);
    expect(res.ok).toBe(false);
    await purgeUser('conv-outsider@test.dev');
  });
});

describe('posting to a named conversation', () => {
  it('the composer is refused a closed workday (R5)', async () => {
    const old = await startWorkday(shiftDay(today(), -1));
    await startWorkday(today());
    const res = await fetch(`${METEOR_URL}/api/huddle_createPost`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authorJwt}` },
      body: JSON.stringify({
        teamId,
        content: { text: 'Late', mentions: [] },
        postDate: today(),
        conversationId: old.result.id,
      }),
    });
    expect(res.ok).toBe(false);
    // REST carries the error code; the client then refetches the conversation
    // list to find the open workday (R22). Meteor.Error details don't reach REST.
    expect(((await res.json()) as { error?: string }).error).toBe('conversation-closed');
    const db = await getDb();
    expect(await db.collection('huddlePosts').countDocuments({ teamId })).toBe(0);
  });

  it('posts into the open workday it names', async () => {
    const current = await startWorkday();
    const res = await createPost({ conversationId: current.result.id });
    expect((await storedPost(res.result.id)).conversationId).toBe(current.result.id);
  });

  it("refuses another team's conversation or a malformed id", async () => {
    const db = await getDb();
    const foreign = new ObjectId();
    await db.collection('huddleConversations').insertOne({
      _id: foreign,
      teamId: new ObjectId().toHexString(),
      kind: 'workday',
      open: true,
      dateKey: today(),
      closedAt: null,
    });
    expect((await createPost({ conversationId: foreign.toHexString() })).ok).toBe(false);
    expect((await createPost({ conversationId: 'nope' })).ok).toBe(false);
    await db.collection('huddleConversations').deleteOne({ _id: foreign });
  });

  it('a wrap-up still lands on a plan in a closed workday (row 9)', async () => {
    const old = await startWorkday(shiftDay(today(), -1));
    const plan = await createPost({ conversationId: old.result.id });
    await startWorkday(today());
    const res = await wormhole(
      'huddle.updatePost',
      { postId: plan.result.id, content: { text: 'Plan\n\nWrap-up: done', mentions: [] }, wrapUp: true },
      authorJwt,
    );
    expect(res.ok).toBe(true);
    const stored = await storedPost(plan.result.id);
    expect(stored.conversationId).toBe(old.result.id);
    expect(stored.wrapUpAt).toBeTruthy();
  });
});

describe('scheduled posts', () => {
  it('join the workday open at delivery, not the one open when scheduled (rows 13, 15; R11)', async () => {
    await startWorkday(shiftDay(today(), -1));
    const deliverAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const scheduled = await createPost({ deliverAt });
    expect(scheduled.ok).toBe(true);
    expect((await storedPost(scheduled.result.id)).conversationId).toBeUndefined();

    const current = await startWorkday(today());
    const sent = await wormhole('huddle.sendScheduledNow', { postId: scheduled.result.id }, authorJwt);
    expect(sent.ok).toBe(true);
    const delivered = await storedPost(scheduled.result.id);
    expect(delivered.deliveredAt).toBeTruthy();
    expect(delivered.conversationId).toBe(current.result.id);
  });
});
