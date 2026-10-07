/**
 * Users — wormhole REST integration tests.
 *
 * Covers the profile display name round trip: what `users.updateProfile`
 * writes must be what every profile read hands back.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createUserAndGetJwt, wormhole, closeDb, purgeUser } from './helpers';

const USER = { name: 'Original Name', email: 'wh-users-profile@test.dev', password: 'Password1!' };
const USERNAME = 'whusersprofile';

type ProfileResult = { user: { id: string; name: string | null } };

let jwt: string;
let userId: string;
let renamed: Awaited<ReturnType<typeof wormhole<ProfileResult>>>;

beforeAll(async () => {
  await purgeUser(USER.email);
  ({ jwt, userId } = await createUserAndGetJwt(USER));
  const claim = await wormhole('users.claimUsername', { username: USERNAME }, jwt);
  expect(claim.ok).toBe(true);
  // Every test below reads the renamed state, so each one runs on its own.
  renamed = await wormhole<ProfileResult>('users.updateProfile', { name: '  Renamed User  ' }, jwt);
});

afterAll(async () => {
  await purgeUser(USER.email);
  await closeDb();
});

describe('users.updateProfile', () => {
  it('returns the new display name, trimmed', () => {
    expect(renamed.ok).toBe(true);
    expect(renamed.result.user.name).toBe('Renamed User');
  });

  it('serves the new display name from every profile read', async () => {
    const byId = await wormhole<ProfileResult>('users.get', { userId }, jwt);
    expect(byId.result.user.name).toBe('Renamed User');

    const byUsername = await wormhole<ProfileResult>(
      'users.getByUsername',
      { username: USERNAME },
      jwt,
    );
    expect(byUsername.result.user.name).toBe('Renamed User');

    const batch = await wormhole<{ users: ProfileResult['user'][] }>(
      'users.batchGet',
      { ids: [userId] },
      jwt,
    );
    expect(batch.result.users[0].name).toBe('Renamed User');
  });

  it('leaves the display name alone when only other fields change', async () => {
    const res = await wormhole<ProfileResult>('users.updateProfile', { bio: 'Hello' }, jwt);
    expect(res.ok).toBe(true);
    expect(res.result.user.name).toBe('Renamed User');
  });

  it('rejects a blank display name and keeps the current one', async () => {
    const res = await wormhole<ProfileResult>('users.updateProfile', { name: '   ' }, jwt);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/empty/i);

    const byId = await wormhole<ProfileResult>('users.get', { userId }, jwt);
    expect(byId.result.user.name).toBe('Renamed User');
  });
});
