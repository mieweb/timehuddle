import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeSession } from './computeSession.js';
import { computeDay } from './computeDay.js';
import type { RawSession } from './types.js';

/** Helper: minutes to epoch ms offset from a base time */
const BASE = Date.UTC(2026, 2, 20, 0, 0, 0); // 2026-03-20 00:00 UTC
const t = (hours: number, minutes: number) =>
  BASE + hours * 3_600_000 + minutes * 60_000;
const mins = (n: number) => n * 60_000;

describe('computeSession', () => {
  it('computes a complete session with tickets and a break', () => {
    const session: RawSession = {
      clockIn: t(9, 0),
      clockOut: t(12, 30),
      ticketSegments: [
        { segmentId: 's1', ticketId: 'T1', ticketTitle: 'Fix bug', start: t(9, 5), end: t(10, 30) },
        { segmentId: 's2', ticketId: 'T2', ticketTitle: 'Review PR', start: t(10, 31), end: t(12, 0) },
      ],
      breaks: [
        { breakId: 'b1', start: t(11, 0), end: t(11, 15) },
      ],
    };

    const stats = computeSession(session, t(12, 30));

    assert.equal(stats.totalSessionMs, mins(210));   // 3h 30m
    assert.equal(stats.totalBreakMs, mins(15));
    assert.equal(stats.netWorkMs, mins(195));         // 3h 15m
    assert.equal(stats.isOpen, false);
    assert.equal(stats.isOnBreak, false);
    assert.equal(stats.activeTicketId, null);

    // T1: 09:05 → 10:30 = 85 min, no break overlap
    const t1 = stats.ticketBreakdown.find((t) => t.ticketId === 'T1')!;
    assert.equal(t1.totalMs, mins(85));

    // T2: 10:31 → 12:00 = 89 min, break overlap 15 min → 74 min
    const t2 = stats.ticketBreakdown.find((t) => t.ticketId === 'T2')!;
    assert.equal(t2.totalMs, mins(74));

    // Untracked: 195 - 85 - 74 = 36 min
    assert.equal(stats.untrackedMs, mins(36));
  });

  it('handles an open session (no clockOut)', () => {
    const session: RawSession = {
      clockIn: t(9, 0),
      clockOut: null,
      ticketSegments: [
        { segmentId: 's1', ticketId: 'T1', ticketTitle: 'Task', start: t(9, 10), end: null },
      ],
      breaks: [],
    };

    const now = t(11, 0); // 2 hours into the session
    const stats = computeSession(session, now);

    assert.equal(stats.totalSessionMs, mins(120));   // 2h open
    assert.equal(stats.isOpen, true);
    assert.equal(stats.activeTicketId, 'T1');

    const t1 = stats.ticketBreakdown.find((t) => t.ticketId === 'T1')!;
    assert.equal(t1.totalMs, mins(110));             // 09:10 → 11:00
    assert.equal(stats.untrackedMs, mins(10));       // 09:00 → 09:10
  });

  it('handles an open break', () => {
    const session: RawSession = {
      clockIn: t(9, 0),
      clockOut: null,
      ticketSegments: [
        { segmentId: 's1', ticketId: 'T1', ticketTitle: 'Task', start: t(9, 0), end: t(10, 0) },
      ],
      breaks: [
        { breakId: 'b1', start: t(10, 0), end: null },
      ],
    };

    const now = t(10, 30);
    const stats = computeSession(session, now);

    assert.equal(stats.totalSessionMs, mins(90));    // 09:00 → 10:30
    assert.equal(stats.totalBreakMs, mins(30));      // 10:00 → 10:30 (open)
    assert.equal(stats.netWorkMs, mins(60));
    assert.equal(stats.isOnBreak, true);
    assert.equal(stats.isOpen, true);
  });

  it('handles a session with no tickets (just clocked in)', () => {
    const session: RawSession = {
      clockIn: t(9, 0),
      clockOut: t(17, 0),
      ticketSegments: [],
      breaks: [],
    };

    const stats = computeSession(session, t(17, 0));

    assert.equal(stats.totalSessionMs, mins(480));   // 8h
    assert.equal(stats.totalBreakMs, 0);
    assert.equal(stats.netWorkMs, mins(480));
    assert.equal(stats.untrackedMs, mins(480));      // All untracked
    assert.deepEqual(stats.ticketBreakdown, []);
  });

  it('merges multiple segments for the same ticket', () => {
    const session: RawSession = {
      clockIn: t(9, 0),
      clockOut: t(12, 0),
      ticketSegments: [
        { segmentId: 's1', ticketId: 'T1', ticketTitle: 'Bug', start: t(9, 0), end: t(10, 0) },
        { segmentId: 's2', ticketId: 'T2', ticketTitle: 'PR', start: t(10, 0), end: t(10, 30) },
        { segmentId: 's3', ticketId: 'T1', ticketTitle: 'Bug', start: t(10, 30), end: t(12, 0) },
      ],
      breaks: [],
    };

    const stats = computeSession(session, t(12, 0));

    // T1: 60 + 90 = 150 min
    const t1 = stats.ticketBreakdown.find((t) => t.ticketId === 'T1')!;
    assert.equal(t1.totalMs, mins(150));

    // T2: 30 min
    const t2 = stats.ticketBreakdown.find((t) => t.ticketId === 'T2')!;
    assert.equal(t2.totalMs, mins(30));

    assert.equal(stats.ticketBreakdown.length, 2); // Merged, not 3
    assert.equal(stats.untrackedMs, 0);
  });

  it('subtracts break time from the correct ticket when break overlaps a segment', () => {
    // Ticket T1 from 09:00 to 11:00
    // Break from 09:30 to 10:00 (30 min overlap with T1)
    const session: RawSession = {
      clockIn: t(9, 0),
      clockOut: t(11, 0),
      ticketSegments: [
        { segmentId: 's1', ticketId: 'T1', ticketTitle: 'Task', start: t(9, 0), end: t(11, 0) },
      ],
      breaks: [
        { breakId: 'b1', start: t(9, 30), end: t(10, 0) },
      ],
    };

    const stats = computeSession(session, t(11, 0));

    assert.equal(stats.totalSessionMs, mins(120));   // 2h
    assert.equal(stats.totalBreakMs, mins(30));
    assert.equal(stats.netWorkMs, mins(90));

    const t1 = stats.ticketBreakdown.find((t) => t.ticketId === 'T1')!;
    // T1 raw: 120 min, break overlap: 30 min → 90 min
    assert.equal(t1.totalMs, mins(90));
    assert.equal(stats.untrackedMs, 0);
  });
});

describe('computeDay', () => {
  it('sums multiple sessions into day totals', () => {
    const morning: RawSession = {
      clockIn: t(9, 0),
      clockOut: t(12, 30),
      ticketSegments: [
        { segmentId: 's1', ticketId: 'T1', ticketTitle: 'Bug', start: t(9, 0), end: t(12, 0) },
      ],
      breaks: [
        { breakId: 'b1', start: t(11, 0), end: t(11, 15) },
      ],
    };

    const afternoon: RawSession = {
      clockIn: t(14, 0),
      clockOut: t(17, 0),
      ticketSegments: [
        { segmentId: 's2', ticketId: 'T1', ticketTitle: 'Bug', start: t(14, 0), end: t(15, 0) },
        { segmentId: 's3', ticketId: 'T2', ticketTitle: 'PR', start: t(15, 0), end: t(17, 0) },
      ],
      breaks: [],
    };

    const day = computeDay([morning, afternoon], '2026-03-20', t(17, 0));

    // Morning: 3h30m session, 15m break → 3h15m net
    // Afternoon: 3h session, 0 break → 3h net
    assert.equal(day.totalSessionMs, mins(210) + mins(180));  // 6h 30m
    assert.equal(day.totalBreakMs, mins(15));
    assert.equal(day.netWorkMs, mins(375));                    // 6h 15m
    assert.equal(day.sessionCount, 2);
    assert.equal(day.hasOpenSession, false);

    // T1: morning (180-15=165 min) + afternoon (60 min) = 225 min
    const t1 = day.ticketBreakdown.find((t) => t.ticketId === 'T1')!;
    assert.equal(t1.totalMs, mins(165 + 60));

    // T2: afternoon 120 min
    const t2 = day.ticketBreakdown.find((t) => t.ticketId === 'T2')!;
    assert.equal(t2.totalMs, mins(120));

    assert.equal(day.ticketBreakdown.length, 2); // Merged across sessions
  });

  it('handles a day with one open session', () => {
    const session: RawSession = {
      clockIn: t(9, 0),
      clockOut: null,
      ticketSegments: [],
      breaks: [],
    };

    const now = t(12, 0);
    const day = computeDay([session], '2026-03-20', now);

    assert.equal(day.totalSessionMs, mins(180)); // 3h open
    assert.equal(day.hasOpenSession, true);
    assert.equal(day.sessionCount, 1);
  });

  it('handles an empty day (no sessions)', () => {
    const day = computeDay([], '2026-03-20', t(17, 0));

    assert.equal(day.totalSessionMs, 0);
    assert.equal(day.totalBreakMs, 0);
    assert.equal(day.netWorkMs, 0);
    assert.equal(day.sessionCount, 0);
    assert.equal(day.hasOpenSession, false);
    assert.deepEqual(day.ticketBreakdown, []);
  });

  it('handles a day with mixed open and closed sessions', () => {
    const closed: RawSession = {
      clockIn: t(9, 0),
      clockOut: t(12, 0),
      ticketSegments: [
        { segmentId: 's1', ticketId: 'T1', ticketTitle: 'Bug', start: t(9, 0), end: t(12, 0) },
      ],
      breaks: [],
    };
    const open: RawSession = {
      clockIn: t(14, 0),
      clockOut: null,
      ticketSegments: [
        { segmentId: 's2', ticketId: 'T1', ticketTitle: 'Bug', start: t(14, 0), end: null },
      ],
      breaks: [],
    };

    const now = t(15, 0);
    const day = computeDay([closed, open], '2026-03-20', now);

    assert.equal(day.sessionCount, 2);
    assert.equal(day.hasOpenSession, true);
    assert.equal(day.totalSessionMs, mins(180) + mins(60)); // 3h + 1h
    assert.equal(day.totalBreakMs, 0);

    // T1 merged across sessions: 180 + 60 = 240 min
    const t1 = day.ticketBreakdown.find((t) => t.ticketId === 'T1')!;
    assert.equal(t1.totalMs, mins(240));
    assert.equal(day.ticketBreakdown.length, 1);
  });
});

// ─── Edge Cases ───────────────────────────────────────────────────────────

describe('computeSession — edge cases', () => {
  it('handles a break outside of any ticket segment (untracked gap)', () => {
    // Session: 09:00 → 12:00
    // Ticket: 09:00 → 10:00
    // Break:  10:30 → 11:00 (during untracked time)
    const session: RawSession = {
      clockIn: t(9, 0),
      clockOut: t(12, 0),
      ticketSegments: [
        { segmentId: 's1', ticketId: 'T1', ticketTitle: 'Task', start: t(9, 0), end: t(10, 0) },
      ],
      breaks: [
        { breakId: 'b1', start: t(10, 30), end: t(11, 0) },
      ],
    };

    const stats = computeSession(session, t(12, 0));

    assert.equal(stats.totalSessionMs, mins(180));  // 3h
    assert.equal(stats.totalBreakMs, mins(30));
    assert.equal(stats.netWorkMs, mins(150));       // 2h 30m

    // T1 has NO break overlap (break is outside T1 range)
    const t1 = stats.ticketBreakdown.find((t) => t.ticketId === 'T1')!;
    assert.equal(t1.totalMs, mins(60));

    // Untracked: netWork(150) - ticket(60) = 90
    assert.equal(stats.untrackedMs, mins(90));
  });

  it('handles multiple breaks overlapping a single segment', () => {
    // Session: 09:00 → 13:00
    // Ticket: 09:00 → 13:00 (4h total)
    // Break 1: 10:00 → 10:15
    // Break 2: 11:00 → 11:30
    const session: RawSession = {
      clockIn: t(9, 0),
      clockOut: t(13, 0),
      ticketSegments: [
        { segmentId: 's1', ticketId: 'T1', ticketTitle: 'Task', start: t(9, 0), end: t(13, 0) },
      ],
      breaks: [
        { breakId: 'b1', start: t(10, 0), end: t(10, 15) },
        { breakId: 'b2', start: t(11, 0), end: t(11, 30) },
      ],
    };

    const stats = computeSession(session, t(13, 0));

    assert.equal(stats.totalSessionMs, mins(240));  // 4h
    assert.equal(stats.totalBreakMs, mins(45));     // 15 + 30
    assert.equal(stats.netWorkMs, mins(195));

    // T1: 240 - 45 break overlap = 195
    const t1 = stats.ticketBreakdown.find((t) => t.ticketId === 'T1')!;
    assert.equal(t1.totalMs, mins(195));
    assert.equal(stats.untrackedMs, 0);
  });

  it('handles a very short session (under 1 minute)', () => {
    const session: RawSession = {
      clockIn: t(9, 0),
      clockOut: t(9, 0) + 30_000, // 30 seconds
      ticketSegments: [],
      breaks: [],
    };

    const stats = computeSession(session, t(9, 0) + 30_000);

    assert.equal(stats.totalSessionMs, 30_000);
    assert.equal(stats.netWorkMs, 30_000);
    assert.equal(stats.untrackedMs, 30_000);
    assert.equal(stats.isOpen, false);
  });

  it('handles a zero-length session (clockIn === clockOut)', () => {
    const session: RawSession = {
      clockIn: t(9, 0),
      clockOut: t(9, 0),
      ticketSegments: [],
      breaks: [],
    };

    const stats = computeSession(session, t(9, 0));

    assert.equal(stats.totalSessionMs, 0);
    assert.equal(stats.netWorkMs, 0);
    assert.equal(stats.untrackedMs, 0);
  });

  it('handles a break that spans the entire ticket segment', () => {
    // Session: 09:00 → 11:00
    // Ticket: 09:00 → 11:00
    // Break:  09:00 → 11:00 (equals entire segment)
    const session: RawSession = {
      clockIn: t(9, 0),
      clockOut: t(11, 0),
      ticketSegments: [
        { segmentId: 's1', ticketId: 'T1', ticketTitle: 'Task', start: t(9, 0), end: t(11, 0) },
      ],
      breaks: [
        { breakId: 'b1', start: t(9, 0), end: t(11, 0) },
      ],
    };

    const stats = computeSession(session, t(11, 0));

    assert.equal(stats.totalSessionMs, mins(120));
    assert.equal(stats.totalBreakMs, mins(120));
    assert.equal(stats.netWorkMs, 0);

    // Ticket's segment is fully covered by break
    const t1 = stats.ticketBreakdown.find((t) => t.ticketId === 'T1')!;
    assert.equal(t1.totalMs, 0);
    assert.equal(stats.untrackedMs, 0);
  });

  it('handles a break that partially overlaps two different tickets', () => {
    // Session: 09:00 → 12:00
    // T1: 09:00 → 10:30
    // T2: 10:30 → 12:00
    // Break: 10:00 → 11:00 (30 min in T1, 30 min in T2)
    const session: RawSession = {
      clockIn: t(9, 0),
      clockOut: t(12, 0),
      ticketSegments: [
        { segmentId: 's1', ticketId: 'T1', ticketTitle: 'Bug', start: t(9, 0), end: t(10, 30) },
        { segmentId: 's2', ticketId: 'T2', ticketTitle: 'PR', start: t(10, 30), end: t(12, 0) },
      ],
      breaks: [
        { breakId: 'b1', start: t(10, 0), end: t(11, 0) },
      ],
    };

    const stats = computeSession(session, t(12, 0));

    assert.equal(stats.totalSessionMs, mins(180));
    assert.equal(stats.totalBreakMs, mins(60));
    assert.equal(stats.netWorkMs, mins(120));

    // T1: 90 min segment - 30 min break overlap = 60 min
    const t1 = stats.ticketBreakdown.find((t) => t.ticketId === 'T1')!;
    assert.equal(t1.totalMs, mins(60));

    // T2: 90 min segment - 30 min break overlap = 60 min
    const t2 = stats.ticketBreakdown.find((t) => t.ticketId === 'T2')!;
    assert.equal(t2.totalMs, mins(60));

    assert.equal(stats.untrackedMs, 0);
  });

  it('handles referenceTime properly for an open session with open break and active ticket', () => {
    // Session: 09:00 → open
    // T1: 09:00 → 10:00 (closed)
    // T2: 10:00 → open (active)
    // Break: 10:30 → open
    const session: RawSession = {
      clockIn: t(9, 0),
      clockOut: null,
      ticketSegments: [
        { segmentId: 's1', ticketId: 'T1', ticketTitle: 'Bug', start: t(9, 0), end: t(10, 0) },
        { segmentId: 's2', ticketId: 'T2', ticketTitle: 'PR', start: t(10, 0), end: null },
      ],
      breaks: [
        { breakId: 'b1', start: t(10, 30), end: null },
      ],
    };

    const now = t(11, 0);
    const stats = computeSession(session, now);

    assert.equal(stats.totalSessionMs, mins(120)); // 09:00 → 11:00
    assert.equal(stats.totalBreakMs, mins(30));    // 10:30 → 11:00
    assert.equal(stats.netWorkMs, mins(90));
    assert.equal(stats.isOpen, true);
    assert.equal(stats.isOnBreak, true);
    assert.equal(stats.activeTicketId, 'T2');

    // T1: 60 min, no break overlap
    const t1 = stats.ticketBreakdown.find((t) => t.ticketId === 'T1')!;
    assert.equal(t1.totalMs, mins(60));

    // T2: 60 min segment (10:00→11:00) - 30 min break overlap = 30 min
    const t2 = stats.ticketBreakdown.find((t) => t.ticketId === 'T2')!;
    assert.equal(t2.totalMs, mins(30));

    assert.equal(stats.untrackedMs, 0);
  });

  it('referenceTime changes values for an open session (live ticking)', () => {
    const session: RawSession = {
      clockIn: t(9, 0),
      clockOut: null,
      ticketSegments: [
        { segmentId: 's1', ticketId: 'T1', ticketTitle: 'Task', start: t(9, 0), end: null },
      ],
      breaks: [],
    };

    const at1000 = computeSession(session, t(10, 0));
    const at1100 = computeSession(session, t(11, 0));

    // Same session, different referenceTime → different values
    assert.equal(at1000.totalSessionMs, mins(60));
    assert.equal(at1100.totalSessionMs, mins(120));

    assert.equal(at1000.ticketBreakdown[0].totalMs, mins(60));
    assert.equal(at1100.ticketBreakdown[0].totalMs, mins(120));
  });

  it('handles tickets with non-contiguous segments (gaps between)', () => {
    // Session: 09:00 → 12:00
    // T1: 09:00 → 09:30
    // (gap from 09:30 to 10:00 — no ticket)
    // T1: 10:00 → 11:00
    // (gap from 11:00 to 12:00)
    const session: RawSession = {
      clockIn: t(9, 0),
      clockOut: t(12, 0),
      ticketSegments: [
        { segmentId: 's1', ticketId: 'T1', ticketTitle: 'Task', start: t(9, 0), end: t(9, 30) },
        { segmentId: 's2', ticketId: 'T1', ticketTitle: 'Task', start: t(10, 0), end: t(11, 0) },
      ],
      breaks: [],
    };

    const stats = computeSession(session, t(12, 0));

    assert.equal(stats.totalSessionMs, mins(180));
    assert.equal(stats.netWorkMs, mins(180));

    // T1: 30 + 60 = 90 min (merged)
    const t1 = stats.ticketBreakdown.find((t) => t.ticketId === 'T1')!;
    assert.equal(t1.totalMs, mins(90));
    assert.equal(stats.ticketBreakdown.length, 1);

    // Untracked: 180 - 90 = 90 min
    assert.equal(stats.untrackedMs, mins(90));
  });
});
