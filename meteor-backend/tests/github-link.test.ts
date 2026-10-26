/**
 * GitHub account linking (#725) — wormhole REST integration tests.
 *
 * Covers what is deterministic without GitHub: auth, status, the stored link
 * token (hash only, expiring), confirming a staged link, and disconnect. The
 * OAuth callback that stages it needs a real GitHub authorization and is
 * covered by a manual pass; these tests stage it in the db instead.
 *
 * Prerequisite: the dedicated test Meteor backend (see tests/setup.ts).
 */
import { createHash } from 'node:crypto';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { createUserAndGetJwt, wormhole, getDb, closeDb, purgeUser } from './helpers';

const USER = { name: 'GitHub Link User', email: 'wh-github-link@test.dev', password: 'Password1!' };
const OTHER = { name: 'GitHub Link Other', email: 'wh-github-link-other@test.dev', password: 'Password1!' };

let jwt: string;
let userId: string;
let otherJwt: string;
let otherId: string;

async function githubServices(id = userId) {
  const db = await getDb();
  const user = await db.collection('users').findOne({ _id: id as never });
  return user?.services as { github?: unknown; githubLink?: Record<string, unknown> } | undefined;
}

/** What the OAuth callback leaves behind: a staged link and its confirm code. */
async function stageLink(id: string, githubId: number, expiresInMs = 60_000) {
  const code = `confirm-${githubId}-${Date.now()}`;
  const db = await getDb();
  await db.collection('users').updateOne(
    { _id: id as never },
    {
      $set: {
        'services.githubLink': {
          // Accounts._hashLoginToken
          confirmHash: createHash('sha256').update(code).digest('base64'),
          githubId,
          username: `gh-${githubId}`,
          expiresAt: new Date(Date.now() + expiresInMs),
        },
      },
    },
  );
  return code;
}

async function unlink(id: string) {
  const db = await getDb();
  await db
    .collection('users')
    .updateOne({ _id: id as never }, { $unset: { 'services.github': 1, 'services.githubLink': 1 } });
}

beforeAll(async () => {
  await purgeUser(USER.email);
  await purgeUser(OTHER.email);
  ({ jwt, userId } = await createUserAndGetJwt(USER));
  ({ jwt: otherJwt, userId: otherId } = await createUserAndGetJwt(OTHER));
});

afterAll(async () => {
  await purgeUser(USER.email);
  await purgeUser(OTHER.email);
  await closeDb();
});

describe('github link (wormhole)', () => {
  it('rejects unauthenticated calls', async () => {
    for (const method of ['github.status', 'github.linkToken', 'github.disconnect']) {
      const res = await wormhole(method, {}, 'invalid-jwt');
      expect(res.ok, method).toBe(false);
    }
    const confirm = await wormhole('github.confirmLink', { code: 'x' }, 'invalid-jwt');
    expect(confirm.ok, 'github.confirmLink').toBe(false);
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

  it('confirms a staged link for the user who started it, once', async () => {
    await unlink(userId);
    const code = await stageLink(userId, 5001);

    const res = await wormhole('github.confirmLink', { code }, jwt);
    expect(res.ok).toBe(true);
    expect(res.result).toEqual({
      result: 'connected',
      status: { connected: true, username: 'gh-5001' },
    });
    const services = await githubServices();
    expect(services?.github).toEqual({ id: 5001, username: 'gh-5001' });
    expect(services?.githubLink).toBeUndefined();

    const again = await wormhole<{ result: string }>('github.confirmLink', { code }, jwt);
    expect(again.result?.result).toBe('expired');
  });

  it("refuses another user's staged link, and leaves it untouched", async () => {
    // A link URL sent to someone else: their session cannot finish it.
    await unlink(userId);
    await unlink(otherId);
    const code = await stageLink(userId, 5002);

    const res = await wormhole<{ result: string }>('github.confirmLink', { code }, otherJwt);
    expect(res.ok).toBe(true);
    expect(res.result?.result).toBe('expired');
    expect((await githubServices(otherId))?.github).toBeUndefined();
    expect((await githubServices())?.github).toBeUndefined();
    expect((await githubServices())?.githubLink).toBeTruthy();
  });

  it('refuses an expired staged link', async () => {
    await unlink(userId);
    const code = await stageLink(userId, 5003, -1000);

    const res = await wormhole<{ result: string }>('github.confirmLink', { code }, jwt);
    expect(res.result?.result).toBe('expired');
    expect((await githubServices())?.github).toBeUndefined();
  });

  it('refuses a GitHub account linked to another user since it was staged', async () => {
    await unlink(userId);
    const db = await getDb();
    await db
      .collection('users')
      .updateOne(
        { _id: otherId as never },
        { $set: { 'services.github': { id: 5004, username: 'gh-5004' } } },
      );
    const code = await stageLink(userId, 5004);

    const res = await wormhole<{ result: string }>('github.confirmLink', { code }, jwt);
    expect(res.result?.result).toBe('taken');
    expect((await githubServices())?.github).toBeUndefined();
    await unlink(otherId);
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
