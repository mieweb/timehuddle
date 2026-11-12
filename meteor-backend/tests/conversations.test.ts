/**
 * Huddle conversation topics (#866) — every post gets a conversation.
 *
 * M1: a new post joins the legacy workday for its date; a scheduled post gets
 * its conversation only when it is delivered.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createUserAndGetJwt, wormhole, getDb, closeDb, purgeUser, ObjectId } from './helpers';

const AUTHOR = { name: 'Topic Author', email: 'conv-author@test.dev', password: 'Password1!' };
const TEAM_CODE = 'CONV0001';

let authorJwt: string;
let authorUserId: string;
let teamId: string;

async function createPost(params: Record<string, unknown>) {
  const res = await wormhole<{ id: string }>(
    'huddle.createPost',
    { teamId, content: { text: 'A post', mentions: [] }, ...params },
    authorJwt,
  );
  expect(res.ok).toBe(true);
  const db = await getDb();
  return (await db.collection('huddlePosts').findOne({ _id: new ObjectId(res.result.id) }))!;
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

afterAll(async () => {
  const db = await getDb();
  await db.collection('teams').deleteMany({ code: TEAM_CODE });
  await db.collection('huddlePosts').deleteMany({ teamId });
  await db.collection('huddleConversations').deleteMany({ teamId });
  await purgeUser(AUTHOR.email);
  await closeDb();
});

describe('every post belongs to a conversation', () => {
  it("joins the legacy workday for the post's date", async () => {
    const post = await createPost({ postDate: '2026-11-11' });
    expect(post.conversationId).toMatch(/^[a-f0-9]{24}$/);

    const db = await getDb();
    const workday = await db
      .collection('huddleConversations')
      .findOne({ _id: new ObjectId(post.conversationId) });
    expect(workday).toMatchObject({ teamId, kind: 'workday', legacy: true, dateKey: '2026-11-11', startedAt: null });
  });

  it('puts two posts on the same day in the same conversation, and a new day in another', async () => {
    const first = await createPost({ postDate: '2026-11-10' });
    const second = await createPost({ postDate: '2026-11-10' });
    const nextDay = await createPost({ postDate: '2026-11-09' });
    expect(second.conversationId).toBe(first.conversationId);
    expect(nextDay.conversationId).not.toBe(first.conversationId);

    const db = await getDb();
    const rows = await db
      .collection('huddleConversations')
      .countDocuments({ teamId, kind: 'workday', legacy: true, dateKey: '2026-11-10' });
    expect(rows).toBe(1);
  });

  it('gives a scheduled post its conversation only when it is delivered', async () => {
    const deliverAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const scheduled = await createPost({ postDate: '2026-11-08', deliverAt });
    expect(scheduled.conversationId).toBeUndefined();

    const sent = await wormhole('huddle.sendScheduledNow', { postId: String(scheduled._id) }, authorJwt);
    expect(sent.ok).toBe(true);

    const db = await getDb();
    const delivered = await db.collection('huddlePosts').findOne({ _id: scheduled._id });
    expect(delivered!.deliveredAt).toBeTruthy();
    expect(delivered!.conversationId).toMatch(/^[a-f0-9]{24}$/);
  });

  it('returns the conversation id in the feed', async () => {
    const post = await createPost({ postDate: '2026-11-07' });
    const feed = await wormhole<{ posts: { id: string; conversationId?: string }[] }>(
      'huddle.getPosts',
      { teamId, since: new Date('2026-01-01').toISOString() },
      authorJwt,
    );
    expect(feed.ok).toBe(true);
    const fromFeed = feed.result.posts.find((p) => p.id === String(post._id));
    expect(fromFeed?.conversationId).toBe(post.conversationId);
  });
});
