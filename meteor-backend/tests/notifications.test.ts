/**
 * Notifications — wormhole REST integration tests.
 *
 * Focus: notifications.testPush
 * Tests push notification creation and delivery.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createUserAndGetJwt,
  wormhole,
  getDb,
  closeDb,
  purgeUser,
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
