/**
 * Unit tests for pulse-reserve-core (server/pulse-reserve-core.js):
 * `pulsevault.reserve` behind its sign-in, with the real token and the real
 * limiter, and a destination check that stands in for the database.
 */
import { issueCapabilityToken } from '@mieweb/pulsevault/core';
import { describe, it, expect, vi } from 'vitest';

import { resolvedPlace } from '../server/pulse-link-hints-core';
import { createPulseReserve, PULSE_RESERVE_LIMIT, TOO_MANY_RESERVES } from '../server/pulse-reserve-core';
import { createRateLimiter } from '../server/rate-limit';

const USER = 'user1';
const TICKET = 'a'.repeat(24);

/** A token's claims, unverified: what Pulse reads. */
const claimsOf = (token: string) => JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));

/** As pulsevault.js mints one. */
const mintToken = (videoid: string, context: unknown, ref?: string) =>
  issueCapabilityToken(videoid, 'secret', {
    keyId: 'v1',
    issuer: 'https://timecore.example.org',
    context,
    ...(ref ? { ref } : {}),
  });

/** A stand-in for Meteor.Error, with the limiter's wait as pulsevault.js passes it on. */
class Refused extends Error {
  constructor(
    public error: string,
    public reason: string,
    public details: { timeToReset: number },
  ) {
    super(reason);
  }
}

/** A reserve whose destinations all pass their check, with a clock the test moves. */
function reserveWith({ now = () => 0 }: { now?: () => number } = {}) {
  const resolveDestination = vi.fn(async (_userId: string, destination: { kind: string; id?: string }) =>
    destination.kind === 'ticket'
      ? resolvedPlace('ticket', { id: destination.id, names: { title: 'Fix login' } })
      : resolvedPlace(destination.kind, {}),
  );
  const reserve = createPulseReserve({
    limiter: createRateLimiter({ ...PULSE_RESERVE_LIMIT, now }),
    tooManyRequests: (retryAfterMs: number) =>
      new Refused(TOO_MANY_RESERVES.error, TOO_MANY_RESERVES.reason, { timeToReset: retryAfterMs }),
    resolveDestination,
    mintToken,
  });
  return { reserve, resolveDestination };
}

describe('createPulseReserve', () => {
  it("returns the place's ref, and it is the one signed into the token", async () => {
    const { reserve } = reserveWith();
    const reserved = await reserve(USER, { kind: 'ticket', id: TICKET });
    const claims = claimsOf(reserved.uploadToken);

    expect(reserved.ref).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(claims.ref).toBe(reserved.ref);
    expect(claims.artifactId).toBe(reserved.videoid);
    expect(reserved).toMatchObject({ label: 'Fix login', name: 'Fix login' });
    // Who and where are signed; what it is called is not.
    expect(claims.ctx).toEqual({ userId: USER, destination: { kind: 'ticket', id: TICKET } });

    // The same place again: another upload, the same key.
    const again = await reserve(USER, { kind: 'ticket', id: TICKET });
    expect(again.videoid).not.toBe(reserved.videoid);
    expect(again.ref).toBe(reserved.ref);
    expect(claimsOf(again.uploadToken).ref).toBe(reserved.ref);
  });

  it('gives a destination that is not a place a plain reservation: no ref, in the result or the token', async () => {
    const { reserve } = reserveWith();
    const reserved = await reserve(USER, { kind: 'post' });
    expect(Object.keys(reserved).sort()).toEqual(['uploadToken', 'videoid']);
    expect(claimsOf(reserved.uploadToken)).not.toHaveProperty('ref');
  });

  it('refuses the call after the last one allowed in a minute, before anything is read', async () => {
    let clock = 1_000;
    const { reserve, resolveDestination } = reserveWith({ now: () => clock });
    for (let call = 0; call < PULSE_RESERVE_LIMIT.limit; call += 1) await reserve(USER, { kind: 'library' });
    expect(resolveDestination).toHaveBeenCalledTimes(240);

    clock += 20_000;
    const refused = await reserve(USER, { kind: 'library' }).catch((err) => err);
    expect(refused).toBeInstanceOf(Refused);
    expect(refused).toMatchObject({
      error: 'too-many-requests',
      reason: 'Too many Pulse links at once. Try again in a moment.',
      details: { timeToReset: 40_000 },
    });
    expect(resolveDestination).toHaveBeenCalledTimes(240);

    // Counted per person, and only for the minute.
    await expect(reserve('user2', { kind: 'library' })).resolves.toHaveProperty('videoid');
    clock += 40_000;
    await expect(reserve(USER, { kind: 'library' })).resolves.toHaveProperty('videoid');
  });

  it('mints nothing for a destination its check refuses', async () => {
    const mint = vi.fn(mintToken);
    const reserve = createPulseReserve({
      limiter: createRateLimiter(PULSE_RESERVE_LIMIT),
      tooManyRequests: () => new Error('unused'),
      resolveDestination: async () => {
        throw new Error('Ticket not found');
      },
      mintToken: mint,
    });
    await expect(reserve(USER, { kind: 'ticket', id: TICKET })).rejects.toThrow('Ticket not found');
    expect(mint).not.toHaveBeenCalled();
  });
});
