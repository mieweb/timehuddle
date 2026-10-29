/**
 * Notification preferences (#784) — wormhole REST + DDP integration tests.
 *
 * The rules themselves are unit-tested in notification-prefs-core.test.ts;
 * this covers the methods and that createNotification obeys a saved
 * preference end to end (a comment on someone's post).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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

const AUTHOR = { name: 'Prefs Author', email: 'wh-prefs-author@test.dev', password: 'Password1!' };
const COMMENTER = {
  name: 'Prefs Commenter',
  email: 'wh-prefs-commenter@test.dev',
  password: 'Password1!',
};
const TEAM_CODE = 'WHPREF01';

type Events = Record<string, { desktop: boolean; phone: boolean }>;

let authorJwt: string;
let authorId: string;
let commenterId: string;
let teamId: string;
let postId: ObjectId;

async function userIdFor(email: string) {
  const db = await getDb();
  return String((await db.collection('users').findOne({ 'emails.address': email }))!._id);
}

async function commentAsCommenter(text: string) {
  const ddp = new DDPConnection(METEOR_URL.replace(/^http/, 'ws') + '/websocket');
  try {
    await ddp.connect();
    await ddp.login(COMMENTER.email, COMMENTER.password);
    await ddp.call('huddle.addComment', [{ postId: postId.toHexString(), content: text }]);
  } finally {
    ddp.close();
  }
}

async function replyNotificationsForAuthor() {
  const db = await getDb();
  return db
    .collection('notifications')
    .find({ userId: authorId, 'data.type': 'huddle-comment', 'data.postId': postId.toHexString() })
    .toArray();
}

beforeAll(async () => {
  await purgeUser(AUTHOR.email);
  await purgeUser(COMMENTER.email);
  authorJwt = (await createUserAndGetJwt(AUTHOR)).jwt;
  await createUserAndGetJwt(COMMENTER);
  authorId = await userIdFor(AUTHOR.email);
  commenterId = await userIdFor(COMMENTER.email);

  const db = await getDb();
  const team = {
    _id: new ObjectId(),
    name: 'WH Prefs Team',
    members: [authorId, commenterId],
    admins: [authorId],
    code: TEAM_CODE,
    isPersonal: false,
    createdAt: new Date(),
  };
  await db.collection('teams').insertOne(team);
  teamId = team._id.toHexString();

  postId = new ObjectId();
  await db.collection('huddlePosts').insertOne({
    _id: postId,
    teamId,
    userId: authorId,
    content: { text: 'Plan for today', mentions: [] },
    commentCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}, 30000);

beforeEach(async () => {
  const db = await getDb();
  await db.collection('notificationPrefs').deleteMany({ userId: authorId });
  await db.collection('notifications').deleteMany({ userId: authorId });
});

afterAll(async () => {
  const db = await getDb();
  await db.collection('notificationPrefs').deleteMany({ userId: { $in: [authorId, commenterId] } });
  await db.collection('huddleComments').deleteMany({ postId: postId.toHexString() });
  await db.collection('huddlePosts').deleteMany({ teamId });
  await db.collection('teams').deleteMany({ code: TEAM_CODE });
  await purgeUser(AUTHOR.email);
  await purgeUser(COMMENTER.email);
  await closeDb();
});

describe('notificationPrefs.get', () => {
  it('returns every event on for both devices when nothing is saved', async () => {
    const res = await wormhole<{ events: Events }>('notificationPrefs.get', {}, authorJwt);
    expect(res.ok).toBe(true);
    expect(res.result.events.huddleReply).toEqual({ desktop: true, phone: true });
    expect(Object.values(res.result.events).every((e) => e.desktop && e.phone)).toBe(true);
  });
});

describe('notificationPrefs.update', () => {
  it('saves one device and returns the merged settings', async () => {
    const res = await wormhole<{ events: Events }>(
      'notificationPrefs.update',
      { events: { huddleReply: { phone: false } } },
      authorJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.events.huddleReply).toEqual({ desktop: true, phone: false });

    const again = await wormhole<{ events: Events }>('notificationPrefs.get', {}, authorJwt);
    expect(again.result.events.huddleReply).toEqual({ desktop: true, phone: false });
  });

  it('rejects an unknown event', async () => {
    const res = await wormhole('notificationPrefs.update', { events: { nope: { phone: true } } }, authorJwt);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Unknown event/);
  });
});

describe('createNotification obeys preferences', () => {
  it('logs a reply when the user has no preferences', async () => {
    await commentAsCommenter('Looks good');
    expect(await replyNotificationsForAuthor()).toHaveLength(1);
  });

  it('logs nothing when the event is off for both devices', async () => {
    await wormhole(
      'notificationPrefs.update',
      { events: { huddleReply: { desktop: false, phone: false } } },
      authorJwt,
    );
    await commentAsCommenter('Looks good again');
    expect(await replyNotificationsForAuthor()).toHaveLength(0);
  });

  it('still logs when only one device is off', async () => {
    await wormhole('notificationPrefs.update', { events: { huddleReply: { phone: false } } }, authorJwt);
    await commentAsCommenter('One more');
    expect(await replyNotificationsForAuthor()).toHaveLength(1);
  });
});
