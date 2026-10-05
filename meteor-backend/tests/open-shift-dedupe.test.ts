/**
 * Unit tests for the duplicate open-shift cleanup plan (server/open-shift-dedupe.js).
 *
 * Pure module, no Meteor and no database, so these run without a Meteor server
 * on 3101. The startup cleanup in clock.js applies this plan before it builds
 * the one-open-shift-per-team index.
 */
import { describe, it, expect } from 'vitest';

import { planDuplicateShiftClosures } from '../server/open-shift-dedupe';

const HOUR = 60 * 60 * 1000;
const T0 = Date.parse('2026-10-05T08:00:00Z');

const shift = (id: string, userId: string, teamId: string, startTime: number) => ({
  _id: { toHexString: () => id },
  userId,
  teamId,
  startTime,
});

const plan = (shifts: ReturnType<typeof shift>[]) =>
  planDuplicateShiftClosures(shifts).map(({ shift: s, endAt, keptId }) => ({
    id: s._id.toHexString(),
    endAt,
    keptId,
  }));

describe('planDuplicateShiftClosures', () => {
  it('leaves a lone open shift alone', () => {
    expect(plan([shift('a', 'u1', 't1', T0)])).toEqual([]);
  });

  it('keeps the newest and ends each older shift where the next one began', () => {
    const closures = plan([
      shift('c', 'u1', 't1', T0 + 2 * HOUR),
      shift('a', 'u1', 't1', T0),
      shift('b', 'u1', 't1', T0 + HOUR),
    ]);
    expect(closures).toEqual([
      { id: 'a', endAt: T0 + HOUR, keptId: 'c' },
      { id: 'b', endAt: T0 + 2 * HOUR, keptId: 'c' },
    ]);
  });

  it('treats each team, and each person, on their own', () => {
    const closures = plan([
      shift('a1', 'u1', 'team-a', T0),
      shift('b1', 'u1', 'team-b', T0 + HOUR),
      shift('a2', 'u1', 'team-a', T0 + 3 * HOUR),
      shift('x1', 'u2', 'team-a', T0 + 2 * HOUR),
    ]);
    // One shift in team A and one in team B is the per-team clock working, not
    // a duplicate; only the two team-A shifts of u1 are.
    expect(closures).toEqual([{ id: 'a1', endAt: T0 + 3 * HOUR, keptId: 'a2' }]);
  });

  it('breaks a tie on start time by id, so the cleanup is deterministic', () => {
    const closures = plan([shift('b', 'u1', 't1', T0), shift('a', 'u1', 't1', T0)]);
    expect(closures).toEqual([{ id: 'a', endAt: T0, keptId: 'b' }]);
  });
});
