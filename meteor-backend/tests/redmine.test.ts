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

  it('rejects unauthenticated issues.list calls', async () => {
    const res = await wormhole('redmine.issues.list', { scope: 'mine' }, 'invalid-jwt');
    expect(res.ok).toBe(false);
  });

  it('reports not connected (empty issues) for a user with no link', async () => {
    // USER_B never links; the method should short-circuit to a not-connected
    // response instead of erroring, so the view can render its empty state.
    const res = await wormhole<{ connected: boolean; issues: unknown[] }>(
      'redmine.issues.list',
      { scope: 'mine' },
      jwtB,
    );
    expect(res.ok).toBe(true);
    expect(res.result.connected).toBe(false);
    expect(res.result.issues).toEqual([]);
  });

  it('rejects an invalid scope', async () => {
    const res = await wormhole('redmine.issues.list', { scope: 'bogus' }, jwtB);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/scope/i);
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

/**
 * M6 issue create/edit. Like the rest of this file, only the deterministic
 * paths are covered here — auth, input validation and the not-connected gate,
 * all of which run before any Redmine request. The write-and-read-back happy
 * path needs a live instance and is covered by the manual e2e in the M6 plan;
 * its rules are unit-covered in redmine-issue-writes.test.ts.
 */
describe('redmine issues create/edit (wormhole, M6)', () => {
  const M6_METHODS: Array<[string, Record<string, unknown>]> = [
    ['redmine.projects.list', {}],
    ['redmine.projects.formOptions', { projectId: 1 }],
    ['redmine.issues.get', { issueId: 1 }],
    ['redmine.issues.create', { projectId: 1, subject: 'x' }],
    [
      'redmine.issues.update',
      { issueId: 1, expectedUpdatedAt: '2026-01-01T00:00:00.000Z', edits: { priorityId: 2 } },
    ],
  ];

  it.each(M6_METHODS)('rejects unauthenticated %s calls', async (method, params) => {
    const res = await wormhole(method, params, 'invalid-jwt');
    expect(res.ok).toBe(false);
  });

  it.each(M6_METHODS)('requires a linked account for %s', async (method, params) => {
    const res = await wormhole(method, params, jwtB);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Connect your Redmine account first/);
  });

  it('validates the create form before checking the connection', async () => {
    const noSubject = await wormhole('redmine.issues.create', { projectId: 1, subject: '  ' }, jwtB);
    expect(noSubject.ok).toBe(false);
    expect(noSubject.error).toMatch(/subject is required/i);

    const noProject = await wormhole('redmine.issues.create', { subject: 'x' }, jwtB);
    expect(noProject.error).toMatch(/Choose a project/);
  });

  it('rejects malformed ids and a missing expectedUpdatedAt', async () => {
    const badIssue = await wormhole('redmine.issues.get', { issueId: 'abc' }, jwtB);
    expect(badIssue.error).toMatch(/issue id is required/);

    const badProject = await wormhole('redmine.projects.formOptions', { projectId: 0 }, jwtB);
    expect(badProject.error).toMatch(/project id is required/);

    const noVersion = await wormhole('redmine.issues.update', { issueId: 1, edits: {} }, jwtB);
    expect(noVersion.error).toMatch(/expectedUpdatedAt is required/);
  });
});
