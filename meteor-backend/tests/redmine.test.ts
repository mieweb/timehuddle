/**
 * Redmine account linking — wormhole REST integration tests.
 *
 * Exercises the full REST → Meteor method → MongoDB path for the paths that are
 * deterministic without a live Redmine server: authentication, input
 * validation, per-user status isolation, and disconnect idempotency.
 *
 * The valid-key happy path (validate → encrypted upsert → reconnect) requires a
 * reachable Redmine instance and is covered by the manual end-to-end test in
 * huddle_redmine_clock.md; the encryption and status-shaping logic it relies on
 * are unit-covered in redmine-crypto.test.ts and redmine-status.test.ts.
 *
 * Prerequisite: the dedicated test Meteor backend (see tests/setup.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { createUserAndGetJwt, wormhole, getDb, closeDb, purgeUser } from './helpers';

const USER_A = { name: 'Redmine User A', email: 'wh-redmine-a@test.dev', password: 'Password1!' };
const USER_B = { name: 'Redmine User B', email: 'wh-redmine-b@test.dev', password: 'Password1!' };

let jwtA: string;
let jwtB: string;
let userIdA: string;

async function purgeLinks() {
  const db = await getDb();
  await db.collection('redmine_links').deleteMany({ userId: { $in: [userIdA] } });
}

beforeAll(async () => {
  await Promise.all([purgeUser(USER_A.email), purgeUser(USER_B.email)]);
  const [a, b] = await Promise.all([createUserAndGetJwt(USER_A), createUserAndGetJwt(USER_B)]);
  jwtA = a.jwt;
  jwtB = b.jwt;
  userIdA = a.userId;
  await purgeLinks();
});

afterAll(async () => {
  await purgeLinks();
  await Promise.all([purgeUser(USER_A.email), purgeUser(USER_B.email)]);
  await closeDb();
});

describe('redmine (wormhole)', () => {
  it('rejects unauthenticated status calls', async () => {
    const res = await wormhole('redmine.status', {}, 'invalid-jwt');
    expect(res.ok).toBe(false);
  });

  it('rejects unauthenticated connect calls', async () => {
    const res = await wormhole('redmine.connect', { apiKey: 'whatever' }, 'invalid-jwt');
    expect(res.ok).toBe(false);
  });

  it('reports not connected for a fresh user', async () => {
    const res = await wormhole<{ connected: boolean }>('redmine.status', {}, jwtA);
    expect(res.ok).toBe(true);
    expect(res.result.connected).toBe(false);
  });

  it('rejects connect with a missing/blank API key before any Redmine call', async () => {
    const res = await wormhole('redmine.connect', { apiKey: '  ' }, jwtA);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/api key is required/i);
  });

  it('keeps status isolated per user', async () => {
    // Seed a link for user A directly, then confirm user B still sees nothing.
    const db = await getDb();
    await db.collection('redmine_links').insertOne({
      userId: userIdA,
      redmineUserId: 7,
      redmineLogin: 'seeded',
      firstname: 'Seed',
      lastname: 'User',
      mail: 'seed@example.com',
      apiKey: 'iv:tag:cipher',
      linkedAt: new Date(),
    });

    const statusA = await wormhole<{ connected: boolean; redmineLogin?: string }>(
      'redmine.status',
      {},
      jwtA,
    );
    expect(statusA.ok).toBe(true);
    expect(statusA.result.connected).toBe(true);
    expect(statusA.result.redmineLogin).toBe('seeded');
    // The encrypted key must never be returned to the client.
    expect(JSON.stringify(statusA.result)).not.toContain('cipher');

    const statusB = await wormhole<{ connected: boolean }>('redmine.status', {}, jwtB);
    expect(statusB.ok).toBe(true);
    expect(statusB.result.connected).toBe(false);
  });

  it('disconnect clears the link and is idempotent', async () => {
    const first = await wormhole<{ connected: boolean }>('redmine.disconnect', {}, jwtA);
    expect(first.ok).toBe(true);
    expect(first.result.connected).toBe(false);

    const status = await wormhole<{ connected: boolean }>('redmine.status', {}, jwtA);
    expect(status.result.connected).toBe(false);

    // Disconnecting again is a no-op, not an error.
    const second = await wormhole<{ connected: boolean }>('redmine.disconnect', {}, jwtA);
    expect(second.ok).toBe(true);
    expect(second.result.connected).toBe(false);
  });
});
