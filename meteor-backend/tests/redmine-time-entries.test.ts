/**
 * Unit tests for redmine-time-entries (server/redmine-time-entries.js).
 *
 * The rounding rule is the interesting part: it is applied once on summed
 * seconds, and it decides both what Redmine stores and what the read-back check
 * compares against. Under D1 a pushed entry is permanent, so a row that cannot
 * be sent must be withheld rather than attempted and failed.
 */
import { describe, it, expect } from 'vitest';

import {
  toHours,
  isPushable,
  buildPushRows,
  pushableRows,
  unsentTotals,
} from '../server/redmine-time-entries';

const resolver = (trackerName: string | null) =>
  trackerName === 'Bug'
    ? { activityId: 9, activityName: 'Development', reason: 'tracker' }
    : { activityId: null, activityName: null, reason: 'none' };

const issues = new Map([
  ['19', { subject: 'Fix the clock', trackerName: 'Bug' }],
  ['20', { subject: 'Nice to have', trackerName: 'Feature' }],
]);

describe('toHours', () => {
  it('rounds to two places, Redmine’s own display granularity', () => {
    expect(toHours(1820)).toBe(0.51); // 0.5055…
    expect(toHours(3600)).toBe(1);
    expect(toHours(1800)).toBe(0.5);
    expect(toHours(40)).toBe(0.01);
  });

  it('rounds the summed total once instead of each session', () => {
    // Three 20-minute sessions. Rounding each first gives 0.33×3 = 0.99;
    // rounding the sum gives the correct 1.00.
    const perSession = [1200, 1200, 1200].map(toHours).reduce((a, b) => a + b, 0);
    expect(perSession).toBeCloseTo(0.99, 5);
    expect(toHours(1200 * 3)).toBe(1);
  });

  it('returns 0 for nothing, negatives and rubbish', () => {
    expect(toHours(0)).toBe(0);
    expect(toHours(-60)).toBe(0);
    expect(toHours(NaN)).toBe(0);
    expect(toHours(undefined as never)).toBe(0);
  });
});

describe('isPushable', () => {
  it('withholds anything that rounds to zero — Redmine rejects it', () => {
    expect(isPushable(toHours(10))).toBe(false); // 10s → 0.00h
    expect(isPushable(toHours(17))).toBe(false);
    expect(isPushable(toHours(18))).toBe(true); // 18s → 0.01h
  });
});

describe('buildPushRows', () => {
  it('shapes a row with hours, subject and a resolved activity', () => {
    const [row] = buildPushRows(
      [{ ticketId: '19', date: '2026-09-19', seconds: 1820 }],
      issues,
      resolver,
    );
    expect(row).toMatchObject({
      ticketId: '19',
      date: '2026-09-19',
      hours: 0.51,
      subject: 'Fix the clock',
      activityId: 9,
      activityReason: 'tracker',
      blockedReason: null,
    });
  });

  it('sorts newest day first, then by issue id', () => {
    const rows = buildPushRows(
      [
        { ticketId: '20', date: '2026-09-19', seconds: 3600 },
        { ticketId: '19', date: '2026-09-20', seconds: 3600 },
        { ticketId: '19', date: '2026-09-19', seconds: 3600 },
      ],
      issues,
      () => ({ activityId: 9, activityName: 'Development', reason: 'tracker' }),
    );
    expect(rows.map((r) => `${r.date}:${r.ticketId}`)).toEqual([
      '2026-09-20:19',
      '2026-09-19:19',
      '2026-09-19:20',
    ]);
  });

  it('blocks a too-short row rather than letting Redmine 422 it', () => {
    const [row] = buildPushRows(
      [{ ticketId: '19', date: '2026-09-19', seconds: 10 }],
      issues,
      resolver,
    );
    expect(row.hours).toBe(0);
    expect(row.blockedReason).toBe('too-short');
  });

  it('keeps a row whose issue could not be resolved, marked unsendable', () => {
    // Real tracked time — hiding it would silently drop the user's work.
    const [row] = buildPushRows(
      [{ ticketId: '999', date: '2026-09-19', seconds: 3600 }],
      issues,
      resolver,
    );
    expect(row).toMatchObject({
      issueMissing: true,
      subject: null,
      blockedReason: 'issue-unavailable',
    });
  });

  it('blocks a row whose activity could not be resolved', () => {
    // Feature maps to nothing in this stub resolver.
    const [row] = buildPushRows(
      [{ ticketId: '20', date: '2026-09-19', seconds: 3600 }],
      issues,
      resolver,
    );
    expect(row.blockedReason).toBe('no-activity');
  });

  it('tolerates a non-array input', () => {
    expect(buildPushRows(undefined as never, issues, resolver)).toEqual([]);
  });
});

describe('unsentTotals (D5 — pushing a ticket-day more than once)', () => {
  it('sends only the work done after an earlier push', () => {
    // The case that surfaced this: #15 pushed mid-day at 4546s, then worked
    // another 2215s. Only the 2215s may go up, as its own entry.
    const [row] = unsentTotals(
      [{ ticketId: '15', date: '2026-09-21', seconds: 4546 + 2215 }],
      new Map([['15|2026-09-21', 4546]]),
    );
    expect(row).toEqual({
      ticketId: '15',
      date: '2026-09-21',
      seconds: 2215,
      alreadySentSeconds: 4546,
    });
    expect(toHours(row.seconds)).toBe(0.62);
  });

  it('passes a never-pushed ticket-day through whole', () => {
    expect(
      unsentTotals([{ ticketId: '12', date: '2026-09-21', seconds: 1442 }], new Map()),
    ).toEqual([{ ticketId: '12', date: '2026-09-21', seconds: 1442, alreadySentSeconds: 0 }]);
  });

  it('drops a ticket-day with nothing new', () => {
    expect(
      unsentTotals(
        [{ ticketId: '12', date: '2026-09-21', seconds: 1442 }],
        new Map([['12|2026-09-21', 1442]]),
      ),
    ).toEqual([]);
  });

  it('keeps a few new seconds so they can accumulate', () => {
    const [row] = unsentTotals(
      [{ ticketId: '12', date: '2026-09-21', seconds: 1447 }],
      new Map([['12|2026-09-21', 1442]]),
    );
    expect(row.seconds).toBe(5);
    expect(isPushable(toHours(row.seconds))).toBe(false);
  });

  it('never goes negative if more was sent than is now recorded', () => {
    // e.g. a session was deleted after its time was pushed.
    expect(
      unsentTotals(
        [{ ticketId: '12', date: '2026-09-21', seconds: 1000 }],
        new Map([['12|2026-09-21', 1442]]),
      ),
    ).toEqual([]);
  });

  it('carries alreadySentSeconds through to the dialog row', () => {
    const [row] = buildPushRows(
      unsentTotals(
        [{ ticketId: '19', date: '2026-09-21', seconds: 7200 }],
        new Map([['19|2026-09-21', 3600]]),
      ),
      issues,
      resolver,
    );
    expect(row).toMatchObject({ seconds: 3600, alreadySentSeconds: 3600, hours: 1 });
  });
});

describe('pushableRows', () => {
  it('keeps only the rows with no blocking reason', () => {
    const rows = buildPushRows(
      [
        { ticketId: '19', date: '2026-09-19', seconds: 3600 }, // ok
        { ticketId: '19', date: '2026-09-18', seconds: 5 }, // too short
        { ticketId: '999', date: '2026-09-19', seconds: 3600 }, // unknown issue
      ],
      issues,
      resolver,
    );
    expect(pushableRows(rows)).toHaveLength(1);
    expect(pushableRows(rows)[0].date).toBe('2026-09-19');
  });
});
