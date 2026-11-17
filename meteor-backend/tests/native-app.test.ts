/**
 * users.markNativeAppSeen — wormhole REST integration tests (#859).
 *
 * The native app calls this on every start; what it stores is what tells the
 * web app whether someone has the app. The "is it recent" rule itself is unit
 * tested in native-app-core.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createUserAndGetJwt, wormhole, getDb, closeDb, purgeUser } from './helpers';

const USER = { name: 'Native App User', email: 'wh-native-app@test.dev', password: 'Password1!' };

let jwt: string;

const lastSeen = async () => {
  const db = await getDb();
  const user = await db.collection('users').findOne({ 'emails.address': USER.email });
  return user?.nativeAppLastSeenAt as Record<string, Date> | undefined;
};

beforeAll(async () => {
  await purgeUser(USER.email);
  ({ jwt } = await createUserAndGetJwt(USER));
});

afterAll(async () => {
  await purgeUser(USER.email);
  await closeDb();
});

describe('users.markNativeAppSeen', () => {
  it('records when the iOS app was opened', async () => {
    const before = Date.now();
    const res = await wormhole('users.markNativeAppSeen', { platform: 'ios' }, jwt);
    expect(res.ok).toBe(true);

    const seen = await lastSeen();
    expect(seen?.ios).toBeInstanceOf(Date);
    expect(seen!.ios.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it('keeps each platform separately', async () => {
    await wormhole('users.markNativeAppSeen', { platform: 'android' }, jwt);
    const seen = await lastSeen();
    expect(seen?.ios).toBeInstanceOf(Date);
    expect(seen?.android).toBeInstanceOf(Date);
  });

  it('rejects a platform the app does not ship on', async () => {
    const res = await wormhole('users.markNativeAppSeen', { platform: 'web' }, jwt);
    expect(res.ok).toBe(false);
    expect((await lastSeen())?.web).toBeUndefined();
  });

  it('needs a signed-in user', async () => {
    const res = await wormhole('users.markNativeAppSeen', { platform: 'ios' }, 'not-a-token');
    expect(res.ok).toBe(false);
  });
});
