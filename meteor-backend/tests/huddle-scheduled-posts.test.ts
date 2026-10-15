/**
 * Scheduled Huddle posts (#596) against the running test backend: mentions
 * notify, a scheduled post defers them, a hidden one stays the author's until
 * delivered, and the Agenda job follows reschedule and delete.
 *
 * Delivery is driven through `huddle.sendScheduledNow` — it runs the same
 * deliverScheduledPost the Agenda job does, without waiting on the processor.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createUserAndGetJwt,
  DDPConnection,
  wormhole,
  getDb,
  closeDb,
  purgeUser,
  ObjectId,
} from './helpers';
import { METEOR_URL } from './setup';

const AUTHOR = { name: 'Sched Author', email: 'sched-author@test.dev', password: 'Password1!' };
const READER = { name: 'Sched Reader', email: 'sched-reader@test.dev', password: 'Password1!' };
const TEAM_CODE = 'SCHED596';
const HOUR_MS = 60 * 60 * 1000;

let authorJwt: string;
let readerJwt: string;
let authorId: string;
let readerId: string;
let teamId: string;

const inHours = (hours: number) => new Date(Date.now() + hours * HOUR_MS).toISOString();

async function userIdOf(email: string) {
  const db = await getDb();
  return String((await db.collection('users').findOne({ 'emails.address': email }))!._id);
}

async function createPost(params: Record<string, unknown>, jwt = authorJwt) {
  return wormhole<{ id: string }>(
    'huddle.createPost',
    { teamId, content: { text: 'Scheduled hello', mentions: [readerId] }, ...params },
    jwt,
  );
}

async function feedIds(jwt: string) {
  const res = await wormhole<{ posts: { id: string }[] }>('huddle.getPosts', { teamId }, jwt);
  expect(res.ok).toBe(true);
  return res.result.posts.map((p) => p.id);
}

async function mentionsFor(postId: string) {
  const db = await getDb();
  return db
    .collection('notifications')
    .find({ userId: readerId, 'data.type': 'huddle-mention', 'data.postId': postId })
    .toArray();
}

/** Mention notifications are sent after the method returns; give them a moment. */
async function waitForMentions(postId: string, count: number) {
  for (let attempt = 0; attempt < 20; attempt++) {
    if ((await mentionsFor(postId)).length >= count) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return mentionsFor(postId);
}

async function deliveryJobs(postId: string) {
  const db = await getDb();
  return db
    .collection('agendajobs')
    .find({ name: 'huddle-post-deliver', 'data.postId': postId })
    .toArray();
}

async function deletePostViaDdp(postId: string) {
  const ddp = new DDPConnection(METEOR_URL.replace(/^http/, 'ws') + '/websocket');
  try {
    await ddp.connect();
    await ddp.login(AUTHOR.email, AUTHOR.password);
    return await ddp.call('huddle.deletePost', [{ postId }]);
  } finally {
    ddp.close();
  }
}

beforeAll(async () => {
  await purgeUser(AUTHOR.email);
  await purgeUser(READER.email);
  authorJwt = (await createUserAndGetJwt(AUTHOR)).jwt;
  readerJwt = (await createUserAndGetJwt(READER)).jwt;
  authorId = await userIdOf(AUTHOR.email);
  readerId = await userIdOf(READER.email);

  const db = await getDb();
  const teamDoc = {
    _id: new ObjectId(),
    name: 'Scheduled Posts Team',
    members: [authorId, readerId],
    admins: [authorId],
    code: TEAM_CODE,
    isPersonal: false,
    createdAt: new Date(),
  };
  await db.collection('teams').insertOne(teamDoc);
  teamId = teamDoc._id.toHexString();
});

afterAll(async () => {
  const db = await getDb();
  const posts = await db.collection('huddlePosts').find({ teamId }).toArray();
  const postIds = posts.map((p) => String(p._id));
  await db.collection('agendajobs').deleteMany({ 'data.postId': { $in: postIds } });
  await db.collection('notifications').deleteMany({ 'data.postId': { $in: postIds } });
  await db.collection('huddlePosts').deleteMany({ teamId });
  await db.collection('teams').deleteMany({ code: TEAM_CODE });
  await purgeUser(AUTHOR.email);
  await purgeUser(READER.email);
  await closeDb();
});

describe('mention notifications', () => {
  it('notifies a mentioned teammate when the post is created', async () => {
    const res = await createPost({});
    expect(res.ok).toBe(true);
    const notes = await waitForMentions(res.result.id, 1);
    expect(notes).toHaveLength(1);
    expect(notes[0].data.url).toBe(`/app/huddle?team=${teamId}&post=${res.result.id}`);
  });
});

describe('scheduling a post', () => {
  it('rejects a time in the past', async () => {
    const res = await createPost({ deliverAt: inHours(-1) });
    expect(res.ok).toBe(false);
  });

  it('rejects scheduling a wrap-up', async () => {
    const res = await createPost({ deliverAt: inHours(1), wrapUp: true });
    expect(res.ok).toBe(false);
  });

  it('keeps a scheduled post hidden and silent until it is delivered', async () => {
    const deliverAt = inHours(2);
    const res = await createPost({ deliverAt });
    expect(res.ok).toBe(true);
    const postId = res.result.id;

    expect(await feedIds(authorJwt)).toContain(postId);
    expect(await feedIds(readerJwt)).not.toContain(postId);
    const jobs = await deliveryJobs(postId);
    expect(jobs).toHaveLength(1);
    expect(new Date(jobs[0].nextRunAt).toISOString()).toBe(deliverAt);
    await new Promise((r) => setTimeout(r, 300));
    expect(await mentionsFor(postId)).toHaveLength(0);

    const byReader = await wormhole('huddle.sendScheduledNow', { postId }, readerJwt);
    expect(byReader.ok).toBe(false);

    const sent = await wormhole('huddle.sendScheduledNow', { postId }, authorJwt);
    expect(sent.ok).toBe(true);
    expect(await feedIds(readerJwt)).toContain(postId);
    expect(await waitForMentions(postId, 1)).toHaveLength(1);
    expect(await deliveryJobs(postId)).toHaveLength(0);

    const db = await getDb();
    const post = await db.collection('huddlePosts').findOne({ _id: new ObjectId(postId) });
    expect(post!.deliveredAt).toBeInstanceOf(Date);
    expect(post!.updatedAt.getTime()).toBe(post!.createdAt.getTime());

    const again = await wormhole('huddle.sendScheduledNow', { postId }, authorJwt);
    expect(again.ok).toBe(false);
    expect(await mentionsFor(postId)).toHaveLength(1);
  });

  it('moves the delivery job when rescheduled', async () => {
    const res = await createPost({ deliverAt: inHours(1) });
    const postId = res.result.id;
    const later = inHours(5);

    const moved = await wormhole('huddle.reschedulePost', { postId, deliverAt: later }, authorJwt);
    expect(moved.ok).toBe(true);
    const jobs = await deliveryJobs(postId);
    expect(jobs).toHaveLength(1);
    expect(new Date(jobs[0].nextRunAt).toISOString()).toBe(later);
    expect(await feedIds(readerJwt)).not.toContain(postId);
  });

  it('drops the delivery job when the post is deleted', async () => {
    const res = await createPost({ deliverAt: inHours(1) });
    const postId = res.result.id;
    expect(await deliveryJobs(postId)).toHaveLength(1);

    await deletePostViaDdp(postId);
    expect(await deliveryJobs(postId)).toHaveLength(0);
    expect(await mentionsFor(postId)).toHaveLength(0);
  });
});
