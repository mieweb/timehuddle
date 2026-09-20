/**
 * `users.markReleaseNotesSeen` — wormhole REST tests.
 *
 * The marker decides what the release-notes page flags as unread, and it is
 * written from whichever client the user happens to be on. The rule that
 * matters is that it only ever moves forward: a device still running an older
 * bundle must not walk the marker back and resurface notes the user already
 * read somewhere else.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { createUserAndGetJwt, wormhole, getDb, closeDb, purgeUser } from './helpers';

const USER = {
  name: 'Release Notes User',
  email: 'wh-release-notes-user@test.dev',
  password: 'Password1!',
};

let jwt: string;

async function storedVersion(): Promise<string | undefined> {
  const db = await getDb();
  const user = await db.collection('users').findOne({ 'emails.address': USER.email });
  return user?.releaseNotesSeenVersion;
}

beforeAll(async () => {
  await purgeUser(USER.email);
  jwt = (await createUserAndGetJwt(USER)).jwt;
});

afterAll(async () => {
  await purgeUser(USER.email);
  await closeDb();
});

describe('users.markReleaseNotesSeen', () => {
  it('starts unset for a new user', async () => {
    expect(await storedVersion()).toBeUndefined();
  });

  it('records the version the user has read', async () => {
    const res = await wormhole<{ releaseNotesSeenVersion: string }>(
      'users.markReleaseNotesSeen',
      { version: '1.2.0' },
      jwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.releaseNotesSeenVersion).toBe('1.2.0');
    expect(await storedVersion()).toBe('1.2.0');
  });

  it('moves forward to a newer version', async () => {
    const res = await wormhole<{ releaseNotesSeenVersion: string }>(
      'users.markReleaseNotesSeen',
      { version: '1.10.0' },
      jwt,
    );
    expect(res.ok).toBe(true);
    expect(await storedVersion()).toBe('1.10.0');
  });

  it('ignores an older version from a client still on a stale bundle', async () => {
    const res = await wormhole<{ releaseNotesSeenVersion: string }>(
      'users.markReleaseNotesSeen',
      { version: '1.9.0' },
      jwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.releaseNotesSeenVersion).toBe('1.10.0');
    expect(await storedVersion()).toBe('1.10.0');
  });

  it('rejects a version that is not semver', async () => {
    const res = await wormhole('users.markReleaseNotesSeen', { version: 'next' }, jwt);
    expect(res.ok).toBe(false);
    expect(await storedVersion()).toBe('1.10.0');
  });

  it('rejects an unauthenticated caller', async () => {
    const res = await wormhole('users.markReleaseNotesSeen', { version: '2.0.0' }, 'not-a-jwt');
    expect(res.ok).toBe(false);
    expect(await storedVersion()).toBe('1.10.0');
  });
});
