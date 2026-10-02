/**
 * The Redmine issue methods that reach Redmine more than once per call are
 * metered per user (see rate-limit.js). The limit is checked before the account
 * lookup, so a user with no Redmine link is enough to see it trip: calls under
 * the limit fail for lack of an account, the next one is refused as too many.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { createUserAndGetJwt, purgeUser, wormhole } from './helpers';

const USER = { name: 'Redmine Limit User', email: 'wh-redmine-limit-user@test.dev', password: 'Password1!' };
const TOO_MANY = /Too many Redmine requests/;

let jwt: string;

beforeAll(async () => {
  await purgeUser(USER.email);
  jwt = (await createUserAndGetJwt(USER)).jwt;
});

afterAll(async () => {
  await purgeUser(USER.email);
});

/** Call `method` `limit` times without tripping the limit, then once more. */
async function exhaust(method: string, params: Record<string, unknown>, limit: number) {
  for (let call = 0; call < limit; call += 1) {
    const res = await wormhole(method, params, jwt);
    expect(res.error ?? '').not.toMatch(TOO_MANY);
  }
  return wormhole(method, params, jwt);
}

describe('Redmine issue method limits', () => {
  it('refuses an eleventh issue create in a minute', async () => {
    const res = await exhaust('redmine.issues.create', { projectId: 1, subject: 'Limit probe' }, 10);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(TOO_MANY);
  });

  it('refuses a twenty-first issue update in a minute', async () => {
    const update = { issueId: 1, expectedUpdatedAt: '2026-01-01T00:00:00Z', edits: { description: 'x' } };
    const res = await exhaust('redmine.issues.update', update, 20);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(TOO_MANY);
  });

  it('refuses a twenty-first form-options lookup in a minute', async () => {
    const res = await exhaust('redmine.projects.formOptions', { projectId: 1 }, 20);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(TOO_MANY);
  });

  it('counts the project list against that same budget', async () => {
    const res = await wormhole('redmine.projects.list', {}, jwt);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(TOO_MANY);
  });
});
