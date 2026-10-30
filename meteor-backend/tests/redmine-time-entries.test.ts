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
  hoursAgree,
  isPushable,
  buildPushRows,
  roundUpMinutes,
  sendableForTicketDay,
  unsentTotals,
} from '../server/redmine-time-entries';

/**
 * What Redmine does with a submitted figure, probed against redmine0 on
 * 2026-09-22: it keeps whole minutes and reports them back to two decimals.
 * `toHours` has to produce a value that survives this unchanged.
 */
const asRedmineWouldStore = (hours: number) => Math.round((Math.round(hours * 60) / 60) * 100) / 100;

const DEVELOPMENT = { id: 9, name: 'Development' };

const resolver = (issue: { trackerName: string | null } | null) =>
  issue?.trackerName === 'Bug'
    ? { activityId: 9, activityName: 'Development', reason: 'tracker', options: [DEVELOPMENT] }
    : { activityId: null, activityName: null, reason: 'none' };

const issues = new Map([
  ['19', { subject: 'Fix the clock', trackerName: 'Bug' }],
  ['20', { subject: 'Nice to have', trackerName: 'Feature' }],
]);

describe('toHours', () => {
  it('quantizes to whole minutes, then two places', () => {
    expect(toHours(1820)).toBe(0.5); // 30.33 min → 30 min
    expect(toHours(3600)).toBe(1);
    expect(toHours(1800)).toBe(0.5);
    expect(toHours(40)).toBe(0.02); // 0.67 min → 1 min
  });

  /**
   * The defect this rule exists for. Every row is a real entry from the first
   * live push: the old rule sent a plain 2dp figure, Redmine re-quantized it to
   * minutes, and the read-back disagreed — e.g. 7.39h became 443 min = 7.38h.
   */
  it('survives Redmine’s minute quantization, which plain 2dp rounding did not', () => {
    const firstPush = [392, 1442, 4546, 2195, 2215, 26610, 170, 213, 177, 72];
    for (const seconds of firstPush) {
      const sent = toHours(seconds);
      expect(asRedmineWouldStore(sent)).toBe(sent);
    }
  });

  it('quantizes the summed total once instead of each session', () => {
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
  it('withholds only zero hours, which Redmine rejects', () => {
    expect(isPushable(0)).toBe(false);
    expect(isPushable(toHours(2))).toBe(true); // any tracked time is at least 1 min → 0.02h
    expect(toHours(2)).toBe(0.02);
  });
});

describe('hoursAgree', () => {
  it('accepts a gap of a minute or less — Redmine’s own granularity', () => {
    expect(hoursAgree(0.5, 0.5)).toBe(true);
    expect(hoursAgree(0.11, 0.12)).toBe(true); // the old defect's signature
    expect(hoursAgree(7.39, 7.38)).toBe(true);
  });

  it('flags a difference Redmine cannot explain away', () => {
    expect(hoursAgree(1, 0.5)).toBe(false);
    expect(hoursAgree(0.5, 0)).toBe(false);
  });

  it('rejects a non-numeric reading rather than calling it a match', () => {
    expect(hoursAgree(0.5, NaN)).toBe(false);
    expect(hoursAgree(undefined as never, 0.5)).toBe(false);
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
      hours: 0.5,
      subject: 'Fix the clock',
      activityId: 9,
      activityReason: 'tracker',
      activityOptions: [DEVELOPMENT],
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

  it('blocks a row with no minutes to send rather than letting Redmine 422 it', () => {
    const [row] = buildPushRows(
      [{ ticketId: '19', date: '2026-09-19', seconds: 10, minutes: 0 }],
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

  it('blocks a row whose project has no usable activity', () => {
    // Feature maps to nothing in this stub resolver.
    const [row] = buildPushRows(
      [{ ticketId: '20', date: '2026-09-19', seconds: 3600 }],
      issues,
      resolver,
    );
    expect(row.blockedReason).toBe('no-activity');
    expect(row.activityOptions).toEqual([]);
  });

  it('carries the issue’s Billable field, or null when it has none (#686)', () => {
    const billable = { id: 7, name: 'Billable status', value: '1' };
    const withBillable = new Map([['19', { ...issues.get('19')!, billable }]]);

    const [row] = buildPushRows(
      [{ ticketId: '19', date: '2026-09-19', seconds: 1820 }],
      withBillable,
      resolver,
    );
    const [plain] = buildPushRows(
      [{ ticketId: '19', date: '2026-09-19', seconds: 1820 }],
      issues,
      resolver,
    );

    expect(row.billable).toEqual(billable);
    expect(plain.billable).toBeNull();
  });

  it('tolerates a non-array input', () => {
    expect(buildPushRows(undefined as never, issues, resolver)).toEqual([]);
  });
});

/** A ledger holding one ticket-day whose `seconds` were all sent, as whole minutes. */
const sent = (key: string, seconds: number, minutes = Math.round(seconds / 60)) =>
  new Map([[key, { seconds, discardedSeconds: 0, minutes }]]);

describe('unsentTotals (D5 — pushing a ticket-day more than once)', () => {
  it('sends only the work done after an earlier push', () => {
    // The case that surfaced this: #15 pushed mid-day at 4546s, then worked
    // another 2215s. Only the 2215s may go up, as its own entry.
    const [row] = unsentTotals(
      [{ ticketId: '15', date: '2026-09-21', seconds: 4546 + 2215 }],
      sent('15|2026-09-21', 4546),
    );
    expect(row).toEqual({
      ticketId: '15',
      date: '2026-09-21',
      seconds: 2215,
      alreadySentSeconds: 4546,
      minutes: 37,
      runSeconds: [],
    });
  });

  it('lists only the runs not yet sent', () => {
    const totals = [{ ticketId: '15', date: '2026-09-21', seconds: 300, runSeconds: [60, 60, 180] }];
    const unsentRuns = (held: number) =>
      unsentTotals(totals, sent('15|2026-09-21', held))[0].runSeconds;
    expect(unsentTotals(totals, new Map())[0].runSeconds).toEqual([60, 60, 180]);
    expect(unsentRuns(60)).toEqual([60, 180]);
    expect(unsentRuns(120)).toEqual([180]);
  });

  it('lists no runs when the newest ones do not add up to the unsent time', () => {
    // Two older 60 s runs moved onto a day whose later 600 s run was already sent.
    const [row] = unsentTotals(
      [{ ticketId: '15', date: '2026-09-21', seconds: 720, runSeconds: [60, 60, 600] }],
      sent('15|2026-09-21', 600),
    );
    expect(row).toMatchObject({ seconds: 120, runSeconds: [] });
  });

  it('passes a never-pushed ticket-day through whole', () => {
    expect(
      unsentTotals([{ ticketId: '12', date: '2026-09-21', seconds: 1442 }], new Map()),
    ).toEqual([
      {
        ticketId: '12',
        date: '2026-09-21',
        seconds: 1442,
        alreadySentSeconds: 0,
        minutes: 24,
        runSeconds: [],
      },
    ]);
  });

  it('drops a ticket-day with nothing new', () => {
    expect(
      unsentTotals(
        [{ ticketId: '12', date: '2026-09-21', seconds: 1442 }],
        sent('12|2026-09-21', 1442),
      ),
    ).toEqual([]);
  });

  it('keeps a few new seconds that Redmine already covers, with nothing to send yet', () => {
    const [row] = unsentTotals(
      [{ ticketId: '12', date: '2026-09-21', seconds: 1447 }],
      sent('12|2026-09-21', 1442),
    );
    expect(row.seconds).toBe(5);
    expect(row.minutes).toBe(0);
  });

  it('never goes negative if more was sent than is now recorded', () => {
    // e.g. a session was deleted after its time was pushed.
    expect(
      unsentTotals(
        [{ ticketId: '12', date: '2026-09-21', seconds: 1000 }],
        sent('12|2026-09-21', 1442),
      ),
    ).toEqual([]);
  });

  it('carries alreadySentSeconds through to the dialog row', () => {
    const [row] = buildPushRows(
      unsentTotals(
        [{ ticketId: '19', date: '2026-09-21', seconds: 7200 }],
        sent('19|2026-09-21', 3600),
      ),
      issues,
      resolver,
    );
    expect(row).toMatchObject({ seconds: 3600, alreadySentSeconds: 3600, hours: 1 });
  });

  it('rounds the day, not each push, so repeated pushes do not add up to more', () => {
    const day = (seconds: number) => [{ ticketId: '12', date: '2026-09-21', seconds }];
    // 30 seconds went up as one minute. The next 30 seconds make the day one
    // minute in all, which Redmine already holds — so there is nothing to send.
    const [second] = unsentTotals(day(60), sent('12|2026-09-21', 30, 1));
    expect(second).toMatchObject({ seconds: 30, minutes: 0 });
    expect(buildPushRows([second], issues, resolver)[0].blockedReason).toBe('too-short');

    // Once the day reaches a second whole minute, exactly that minute is owed.
    const [later] = unsentTotals(day(100), sent('12|2026-09-21', 30, 1));
    expect(later).toMatchObject({ seconds: 70, minutes: 1 });
  });

  it('leaves discarded time out of what Redmine is owed', () => {
    const [row] = unsentTotals(
      [{ ticketId: '12', date: '2026-09-21', seconds: 3600 }],
      new Map([['12|2026-09-21', { seconds: 1800, discardedSeconds: 1800, minutes: 0 }]]),
    );
    expect(row).toMatchObject({ seconds: 1800, minutes: 30 });
  });
});

describe('sendableForTicketDay (#688 — what a timer that just ended left to send)', () => {
  const unsent = [
    { ticketId: '15', date: '2026-09-21', seconds: 2215, alreadySentSeconds: 4546, minutes: 37 },
    { ticketId: '15', date: '2026-09-22', seconds: 600, alreadySentSeconds: 0, minutes: 10 },
    { ticketId: '20', date: '2026-09-21', seconds: 20, alreadySentSeconds: 0, minutes: 0 },
  ];

  it('is the one issue-day asked for, in the hours a send would use', () => {
    expect(sendableForTicketDay(unsent, '15', '2026-09-21')).toEqual({
      ticketId: '15',
      date: '2026-09-21',
      hours: 0.62,
    });
  });

  it('is nothing for an issue-day with no unsent time', () => {
    expect(sendableForTicketDay(unsent, '15', '2026-09-23')).toBeNull();
    expect(sendableForTicketDay([], '15', '2026-09-21')).toBeNull();
  });

  it('is nothing for new time Redmine already covers', () => {
    expect(sendableForTicketDay(unsent, '20', '2026-09-21')).toBeNull();
  });
});

describe("rounding up (the Redmine server's setting)", () => {
  const KEY = '7|2026-10-29';
  const step = (minutes: number) => new Map([[KEY, minutes]]);
  const day = (seconds: number) => [{ ticketId: '7', date: '2026-10-29', seconds }];

  it('rounds whole minutes up to the step, or leaves them without one', () => {
    expect([5, 10, 15].map((each) => roundUpMinutes(282, each))).toEqual([285, 290, 285]);
    expect(roundUpMinutes(282, undefined)).toBe(282);
  });

  it('sends exact minutes, with no rounding detail, for a server that does not round', () => {
    const [row] = unsentTotals(day(282 * 60), new Map());
    expect(row.minutes).toBe(282);
    expect(row).not.toHaveProperty('rounding');
  });

  it('rounds up and keeps the exact minutes for the dialog', () => {
    const [row] = unsentTotals(day(282 * 60), new Map(), step(10));
    expect(row.minutes).toBe(290);
    expect(row.rounding).toEqual({ step: 10, exactMinutes: 282 });
  });

  it('rounds the day total, so several stops never add up past it', () => {
    // Up to 15: 0:10 sends 0:15, 0:20 tops up to 0:30, and 0:24 sends nothing.
    expect(unsentTotals(day(600), new Map(), step(15))[0].minutes).toBe(15);
    expect(unsentTotals(day(1200), sent(KEY, 600, 15), step(15))[0].minutes).toBe(15);
    expect(unsentTotals(day(1440), sent(KEY, 1200, 30), step(15))[0].minutes).toBe(0);
  });

  it('shows the time worked since the last send, not less what was rounded up', () => {
    // 0:10 went up as 0:15; another 0:10 tops the day up to 0:30 and shows 0:10 worked.
    const [row] = unsentTotals(day(1200), sent(KEY, 600, 15), step(15));
    expect(row.minutes).toBe(15);
    expect(row.rounding).toEqual({ step: 15, exactMinutes: 10 });
  });

  it('follows a rounding the organization changed after part of the day was sent', () => {
    // 0:12 went up as 0:15 under 5 minutes; with 15 minutes, 0:22 tops up to 0:30.
    expect(unsentTotals(day(22 * 60), sent(KEY, 12 * 60, 15), step(15))[0].minutes).toBe(15);
    // Back to 5 minutes: 0:13 is still covered by the 0:15 sent, so nothing more goes.
    expect(unsentTotals(day(13 * 60), sent(KEY, 12 * 60, 15), step(5))[0].minutes).toBe(0);
  });

  it('rounds a few seconds up to the whole step', () => {
    const [row] = unsentTotals(day(2), new Map(), step(15));
    expect(row.minutes).toBe(15);
    expect(row.rounding).toEqual({ step: 15, exactMinutes: 0 });
  });

  it('sends a few seconds as one minute for a server that does not round', () => {
    expect(unsentTotals(day(2), new Map())[0].minutes).toBe(1);
  });

  it('adds nothing for more seconds that an earlier entry already covers', () => {
    expect(unsentTotals(day(7), sent(KEY, 2, 15), step(15))[0].minutes).toBe(0);
    expect(unsentTotals(day(7), sent(KEY, 2, 1))[0].minutes).toBe(0);
  });

  it('owes nothing for short time that was discarded', () => {
    const discarded = new Map([[KEY, { seconds: 5, discardedSeconds: 5, minutes: 0 }]]);
    expect(unsentTotals(day(5), discarded, step(15))).toEqual([]);
    expect(unsentTotals(day(9), discarded, step(15))[0].minutes).toBe(15);
  });

  it('carries the rounding into the dialog row as hours', () => {
    const [total] = unsentTotals(
      [{ ticketId: '19', date: '2026-10-29', seconds: 282 * 60 }],
      new Map(),
      new Map([['19|2026-10-29', 15]]),
    );
    const [row] = buildPushRows([total], issues, resolver);
    expect(row.hours).toBe(4.75);
    expect(row.rounding).toEqual({ step: 15, exactHours: 4.7 });
  });
});
