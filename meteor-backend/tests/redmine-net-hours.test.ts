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

import { sumClosedSessions, ticketDayKey, ticketDayTotals } from '../server/redmine-net-hours';

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

describe('ticketDayTotals', () => {
  it('pools time timed on an issue with time on a ticket linked to it', () => {
    // A timer on issue 482 itself, and one on a TimeHuddle ticket linked to 482.
    type Session = {
      workItemId?: string;
      redmineIssueId?: string;
      date?: string;
      endTime: number;
      durationSeconds: number;
    };
    const direct: Session = { workItemId: 'w1', endTime: 1, durationSeconds: 1200 };
    const linked: Session = {
      redmineIssueId: '482',
      date: '2026-10-04',
      endTime: 1,
      durationSeconds: 600,
    };
    const keyByWorkItem = new Map([['w1', ticketDayKey('482', '2026-10-04')]]);

    const totals = ticketDayTotals([direct, linked], (session) =>
      session.redmineIssueId
        ? ticketDayKey(session.redmineIssueId, session.date)
        : (keyByWorkItem.get(session.workItemId ?? '') ?? null),
    );
    expect(totals).toEqual([{ ticketId: '482', date: '2026-10-04', seconds: 1800 }]);
  });

  it('keeps time logged under different issues apart, so a relink never moves it', () => {
    const sessions = [
      { redmineIssueId: '482', date: '2026-10-04', endTime: 1, durationSeconds: 900 },
      { redmineIssueId: '500', date: '2026-10-04', endTime: 1, durationSeconds: 300 },
    ];
    const totals = ticketDayTotals(sessions, (s) => ticketDayKey(s.redmineIssueId, s.date));
    expect(totals).toEqual([
      { ticketId: '482', date: '2026-10-04', seconds: 900 },
      { ticketId: '500', date: '2026-10-04', seconds: 300 },
    ]);
  });

  it('leaves out sessions with no ticket-day, and days with no closed time', () => {
    const sessions = [
      { key: null, endTime: 1, durationSeconds: 900 },
      { key: 'x|2026-10-04', endTime: null },
    ];
    expect(ticketDayTotals(sessions, (s) => s.key)).toEqual([]);
  });
});
