/**
 * `pulsevault.reserve` with no Meteor or database: one reservation, from who
 * asks and where the video goes to what the page builds its link from.
 * pulsevault.js supplies the parts that need a server (the destination check,
 * the token's secret, the limiter's counters) and tests supply their own.
 */
import { randomUUID } from 'crypto';

import { pulseLinkHints } from './pulse-link-hints-core.js';

/**
 * How many links one person may reserve (see rate-limit.js). Reserving is a
 * couple of reads and a signature, and a phone's ticket list reserves ahead
 * for each row that stays on screen, so scrolling a long one is some dozens a
 * minute. This is several times that: a person never meets it, and a loop does.
 */
export const PULSE_RESERVE_LIMIT = { limit: 240, windowMs: 60 * 1000 };

/** What a reserve beyond that is refused with: a Meteor.Error's `error` and `reason`. */
export const TOO_MANY_RESERVES = {
  error: 'too-many-requests',
  reason: 'Too many Pulse links at once. Try again in a moment.',
};

/**
 * A `reserve(userId, destination)` built from:
 *  - `limiter`: a rate-limit.js limiter, counted per user before anything is
 *    read; `tooManyRequests(retryAfterMs)` makes the error a refused call throws.
 *  - `resolveDestination(userId, destination)`: checks the destination and
 *    resolves `{ resolved, names }` (pulse-destinations.js), or throws.
 *  - `mintToken(videoid, context, ref)`: the upload's capability token.
 *
 * It resolves `{ videoid, uploadToken }`, and for a destination that is a
 * place (pulse-link-hints-core.js) also `{ ref, label, name? }`: the `ref`
 * returned is the one signed into the token, since both come from here.
 */
export function createPulseReserve({ limiter, tooManyRequests, resolveDestination, mintToken }) {
  return async function reserve(userId, destination) {
    const { allowed, retryAfterMs } = limiter.check(userId);
    if (!allowed) throw tooManyRequests(retryAfterMs);
    const { resolved, names } = await resolveDestination(userId, destination);
    // Always a fresh id: one link is one upload, and a re-scan of the same
    // link resumes it (PulseVault's `reclaim`).
    const videoid = randomUUID();
    // Null for a kind that isn't a place: its link stays plain.
    const place = pulseLinkHints(userId, resolved, names);
    return {
      videoid,
      uploadToken: mintToken(videoid, { userId, destination: resolved }, place?.ref),
      ...place,
    };
  };
}
