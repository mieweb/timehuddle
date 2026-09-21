/**
 * Unit tests for redmine-net-hours (server/redmine-net-hours.js).
 *
 * This is the arithmetic M5 projects to Redmine, so it is worth pinning down
 * precisely. The load-bearing case is the break split: because `clock.pause`
 * closes a session and `clock.resume` opens a new one, a broken work stretch
 * must total exactly what the same stretch would have without the break. Any
 * "subtract the break" logic leaking in here would double-count it.
 */
import { describe, it, expect } from 'vitest';

import { sumClosedSessions } from '../server/redmine-net-hours';

/** A closed session; `endTime` only has to be non-null to count. */
const closed = (durationSeconds: number) => ({ endTime: 1, durationSeconds });

describe('sumClosedSessions', () => {
  it('merges multiple closed sessions into one total', () => {
    expect(sumClosedSessions([closed(1200), closed(600), closed(300)])).toBe(2100);
  });

  it('sums a break-split pair to the same total as the un-broken stretch', () => {
    // clock.pause closed the first half; clock.resume opened the second.
    const withBreak = sumClosedSessions([closed(1800), closed(1800)]);
    const withoutBreak = sumClosedSessions([closed(3600)]);

    expect(withBreak).toBe(withoutBreak);
    expect(withBreak).toBe(3600);
  });

  it('sums two separate shifts in the same calendar day', () => {
    const morning = [closed(3600), closed(1800)];
    const afternoon = [closed(2700), closed(900)];

    expect(sumClosedSessions([...morning, ...afternoon])).toBe(9000);
  });

  it('ignores a still-running session instead of guessing its duration', () => {
    const running = { endTime: null, durationSeconds: undefined };

    expect(sumClosedSessions([closed(3600), running])).toBe(3600);
    expect(sumClosedSessions([running])).toBe(0);
  });

  it('returns 0 for a day with no sessions', () => {
    expect(sumClosedSessions([])).toBe(0);
  });

  it('skips unusable durations rather than returning NaN', () => {
    const total = sumClosedSessions([
      closed(600),
      { endTime: 1, durationSeconds: Number.NaN },
      { endTime: 1, durationSeconds: -50 },
      { endTime: 1, durationSeconds: undefined },
    ]);

    expect(total).toBe(600);
  });

  it('tolerates a non-array input', () => {
    expect(sumClosedSessions(undefined as never)).toBe(0);
  });
});
