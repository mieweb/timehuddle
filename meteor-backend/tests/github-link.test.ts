/**
 * GitHub account linking (#725) — wormhole REST integration tests.
 *
 * Covers what is deterministic without GitHub: auth, status, the stored link
 * token (hash only, expiring), and disconnect. The OAuth callback that redeems
 * the token needs a real GitHub authorization and is covered by a manual pass.
 *
 * Prerequisite: the dedicated test Meteor backend (see tests/setup.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { createUserAndGetJwt, wormhole, getDb, closeDb, purgeUser } from './helpers';

const USER = { name: 'GitHub Link User', email: 'wh-github-link@test.dev', password: 'Password1!' };

let jwt: string;
let userId: string;

async function githubServices() {
  const db = await getDb();
  const user = await db.collection('users').findOne({ _id: userId as never });
  return user?.services as { github?: unknown; githubLink?: Record<string, unknown> } | undefined;
}

beforeAll(async () => {
  await purgeUser(USER.email);
  ({ jwt, userId } = await createUserAndGetJwt(USER));
});

afterAll(async () => {
  await purgeUser(USER.email);
  await closeDb();
});

describe('github link (wormhole)', () => {
  it('rejects unauthenticated calls', async () => {
    for (const method of ['github.status', 'github.linkToken', 'github.disconnect']) {
      const res = await wormhole(method, {}, 'invalid-jwt');
      expect(res.ok, method).toBe(false);
    }
  });

  it('reports not connected for a fresh user', async () => {
    const res = await wormhole('github.status', {}, jwt);
    expect(res.ok).toBe(true);
    expect(res.result).toEqual({ connected: false, username: null });
  });

  it('issues a link token and stores only its hash, with an expiry', async () => {
    const res = await wormhole<{ token: string }>('github.linkToken', {}, jwt);
    expect(res.ok).toBe(true);
    const token = res.result?.token;
    expect(typeof token).toBe('string');

    const link = (await githubServices())?.githubLink;
    expect(link?.hashedToken).toBeTruthy();
    expect(link?.hashedToken).not.toBe(token);
    expect(new Date(link?.expiresAt as string).getTime()).toBeGreaterThan(Date.now());
  });

  it('reports a linked account and unlinks it on disconnect', async () => {
    const db = await getDb();
    await db
      .collection('users')
      .updateOne(
        { _id: userId as never },
        { $set: { 'services.github': { id: 1234, username: 'octocat' } } },
      );

    const linked = await wormhole('github.status', {}, jwt);
    expect(linked.result).toEqual({ connected: true, username: 'octocat' });

    const res = await wormhole('github.disconnect', {}, jwt);
    expect(res.ok).toBe(true);
    expect(res.result).toEqual({ connected: false, username: null });
    expect((await githubServices())?.github).toBeUndefined();
  });
});
