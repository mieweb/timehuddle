/**
 * Notifications — wormhole REST integration tests.
 *
 * Focus: notifications.testPush, and the read time saved on first read (#804)
 * Tests push notification creation and delivery.
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

const TEST_USER = { name: 'Push Test User', email: 'wh-push@test.dev', password: 'Password1!' };

let userJwt: string;
let userId: string;

beforeAll(async () => {
  await purgeUser(TEST_USER.email);
  const user = await createUserAndGetJwt(TEST_USER);
  userJwt = user.jwt;

  const db = await getDb();
  userId = String((await db.collection('users').findOne({ 'emails.address': TEST_USER.email }))!._id);
}, 30000);

afterAll(async () => {
  await purgeUser(TEST_USER.email);
  await closeDb();
});

// ─── notifications.testPush ───────────────────────────────────────────────────

describe('notifications.testPush', () => {
  it('creates a test notification in the database', async () => {
    const db = await getDb();
    
    // Clear existing test notifications
    await db.collection('notifications').deleteMany({
      userId,
      title: 'Test Push',
    });

    // Call testPush
    const res = await wormhole<{ ok: boolean }>(
      'notifications.testPush',
      {},
      userJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.ok).toBe(true);

    // Verify notification was created
    const notification = await db.collection('notifications').findOne({
      userId,
      title: 'Test Push',
      body: 'This is a test push notification',
    });
    expect(notification).toBeTruthy();
    expect(notification!.read).toBe(false);
    expect(notification!.data).toEqual({ type: 'test' });
    expect(notification!.createdAt).toBeInstanceOf(Date);
  });

  it('requires authentication', async () => {
    const res = await wormhole<{ ok: boolean }>(
      'notifications.testPush',
      {},
      'invalid-jwt-token',
    );
    expect(res.ok).toBe(false);
  });

  it('creates notification for the authenticated user only', async () => {
    const db = await getDb();
    
    // Clear existing test notifications for this user
    await db.collection('notifications').deleteMany({
      userId,
      title: 'Test Push',
    });

    // Call testPush
    await wormhole<{ ok: boolean }>(
      'notifications.testPush',
      {},
      userJwt,
    );

    // Count notifications with test title
    const count = await db.collection('notifications').countDocuments({
      userId,
      title: 'Test Push',
    });
    expect(count).toBe(1);

    // Verify it's for the correct user
    const notification = await db.collection('notifications').findOne({
      userId,
      title: 'Test Push',
    });
    expect(notification!.userId).toBe(userId);
  });

  it('can be called multiple times', async () => {
    const db = await getDb();
    
    // Clear existing
    await db.collection('notifications').deleteMany({
      userId,
      title: 'Test Push',
    });

    // Call twice
    await wormhole<{ ok: boolean }>('notifications.testPush', {}, userJwt);
    await wormhole<{ ok: boolean }>('notifications.testPush', {}, userJwt);

    // Should have 2 notifications
    const count = await db.collection('notifications').countDocuments({
      userId,
      title: 'Test Push',
    });
    expect(count).toBe(2);
  });
});

// ─── Read time (#804) ─────────────────────────────────────────────────────────

describe('notification read time', () => {
  const FIRST_READ = new Date('2026-11-01T16:49:00.000Z');

  // Inserts rows for the test user, cleared before each test that uses them.
  async function seed(rows: Array<{ title: string; read: boolean; readAt?: Date }>) {
    const db = await getDb();
    await db.collection('notifications').deleteMany({ userId, 'data.type': 'read-time-test' });
    const docs = rows.map((r) => ({
      ...r,
      _id: new ObjectId(),
      userId,
      body: '',
      data: { type: 'read-time-test' },
      createdAt: new Date(),
    }));
    await db.collection('notifications').insertMany(docs);
    return docs.map((d) => String(d._id));
  }
  const readAtOf = async (id: string) =>
    (await (await getDb()).collection('notifications').findOne({ _id: new ObjectId(id) }))!.readAt;

  it('markOneRead saves the first read time and keeps it when opened again', async () => {
    const [id] = await seed([{ title: 'unread', read: false }]);
    const first = await wormhole<{ readAt: string }>('notifications.markOneRead', { notificationId: id }, userJwt);
    const saved = await readAtOf(id);
    expect(saved).toBeInstanceOf(Date);
    expect(first.result.readAt).toBe(saved.toISOString());

    const again = await wormhole<{ readAt: string }>('notifications.markOneRead', { notificationId: id }, userJwt);
    expect(await readAtOf(id)).toEqual(saved);
    expect(again.result.readAt).toBe(saved.toISOString());
  });

  it('markOneRead returns the stored time for a row already read elsewhere, or null if none', async () => {
    const [readElsewhere, legacy] = await seed([
      { title: 'read on phone', read: true, readAt: FIRST_READ },
      { title: 'read before #804', read: true },
    ]);
    const a = await wormhole<{ readAt: string | null }>('notifications.markOneRead', { notificationId: readElsewhere }, userJwt);
    expect(a.result.readAt).toBe(FIRST_READ.toISOString());
    const b = await wormhole<{ readAt: string | null }>('notifications.markOneRead', { notificationId: legacy }, userJwt);
    expect(b.result.readAt).toBeNull();
    expect(await readAtOf(legacy)).toBeUndefined();
  });

  it('markAllRead stamps only unread rows', async () => {
    const [unread, readElsewhere, legacy] = await seed([
      { title: 'unread', read: false },
      { title: 'read on phone', read: true, readAt: FIRST_READ },
      { title: 'read before #804', read: true },
    ]);
    const res = await wormhole<{ readAt: string }>('notifications.markAllRead', {}, userJwt);
    expect((await readAtOf(unread)).toISOString()).toBe(res.result.readAt);
    expect(await readAtOf(readElsewhere)).toEqual(FIRST_READ);
    expect(await readAtOf(legacy)).toBeUndefined();
  });
});
