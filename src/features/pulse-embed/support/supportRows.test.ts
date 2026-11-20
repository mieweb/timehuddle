import { describe, expect, it } from 'vitest';

import type { PulseUploadAdmin, PulseUploadMetrics } from '../../../lib/api';
import {
  durationText,
  metricItems,
  OVERDUE_AFTER_MS,
  percentText,
  sessionIdOf,
  SUPPORT_LIMIT,
  supportFlags,
  supportPage,
  supportQuery,
  supportRowsForTeam,
  ticketIdOf,
  toSupportRow,
} from './supportRows';
import { SUPPORT_TEXT as T } from './supportStrings';

const TICKET = '64b1f0c2a9e8d7c6b5a49382';
const SESSION = '65aa00b1c2d3e4f5a6b7c8d9';
const NOW = Date.UTC(2026, 10, 19, 12);
const HOUR = 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

const upload = (extra: Partial<PulseUploadAdmin> = {}): PulseUploadAdmin => ({
  id: 'up1',
  userId: 'u1',
  userName: 'Pat Lee',
  type: 'ticket.video',
  targetKey: `ticket:${TICKET}`,
  teamId: 'team1',
  label: 'Fix login',
  state: 'uploading',
  name: null,
  durationMs: null,
  sentAt: iso(NOW - HOUR),
  updatedAt: iso(NOW - HOUR),
  reason: null,
  note: null,
  attachmentId: null,
  mediaId: null,
  ...extra,
});

describe('what the admin types', () => {
  it('reads a ticket from its id or a link to its page', () => {
    expect(ticketIdOf(TICKET.toUpperCase())).toBe(TICKET);
    expect(ticketIdOf(`https://huddle.example/app/tickets/${TICKET}?tab=videos`)).toBe(TICKET);
    expect(ticketIdOf('TH-12')).toBeNull();
    expect(ticketIdOf('')).toBeNull();
  });

  it('reads a session id from text holding one', () => {
    expect(sessionIdOf(` ${SESSION} `)).toBe(SESSION);
    expect(sessionIdOf(`clock:${SESSION}`)).toBe(SESSION);
    expect(sessionIdOf('yesterday')).toBeNull();
  });

  it("builds the adminList query for each way to search, always for the team's rows only", () => {
    const team = { teamId: 'team1', limit: SUPPORT_LIMIT };
    expect(supportQuery('recent', {}, 'team1')).toEqual({ query: team });
    expect(supportQuery('person', { userId: 'u9' }, 'team1')).toEqual({
      query: { ...team, userId: 'u9' },
    });
    expect(supportQuery('ticket', { ticket: TICKET }, 'team1')).toEqual({
      query: { ...team, targetKey: `ticket:${TICKET}` },
    });
    expect(supportQuery('session', { session: SESSION }, 'team1')).toEqual({
      query: { ...team, clockEventId: SESSION },
    });
  });

  it('says what is wrong instead of searching for nothing', () => {
    expect(supportQuery('person', {}, 'team1')).toEqual({ error: T.personPlaceholder });
    expect(supportQuery('ticket', { ticket: 'nope' }, 'team1')).toEqual({ error: T.badTicket });
    expect(supportQuery('session', { session: '' }, 'team1')).toEqual({ error: T.badSession });
  });
});

describe('supportFlags', () => {
  it('flags a video still on its way 24 h after Send, swept or not', () => {
    expect(supportFlags(upload({ sentAt: iso(NOW - OVERDUE_AFTER_MS) }), NOW)).toEqual([
      T.flags.overdue,
    ]);
    expect(
      supportFlags(upload({ state: 'intent', overdueAt: iso(NOW), sentAt: iso(NOW - HOUR) }), NOW),
    ).toEqual([T.flags.overdue]);
    expect(supportFlags(upload(), NOW)).toEqual([]);
  });

  it('never calls a processing or failed video overdue', () => {
    const old = iso(NOW - 3 * OVERDUE_AFTER_MS);
    expect(supportFlags(upload({ state: 'processing', sentAt: old }), NOW)).toEqual([]);
    expect(supportFlags(upload({ state: 'failed', sentAt: old }), NOW)).toEqual([]);
  });

  it('flags an abandoned video, and one that arrived late', () => {
    expect(supportFlags(upload({ state: 'abandoned' }), NOW)).toEqual([T.flags.abandoned]);
    const sent = NOW - 3 * OVERDUE_AFTER_MS;
    expect(
      supportFlags(
        upload({ state: 'delivered', sentAt: iso(sent), deliveredAt: iso(sent + 30 * HOUR) }),
        NOW,
      ),
    ).toEqual([T.flags.late]);
    expect(
      supportFlags(
        upload({ state: 'delivered', sentAt: iso(sent), deliveredAt: iso(sent + HOUR) }),
        NOW,
      ),
    ).toEqual([]);
  });
});

describe('the table rows', () => {
  it('shows one upload as scalars, with words for its kind and state', () => {
    expect(
      toSupportRow(
        upload({
          state: 'kept',
          reason: 'The ticket was deleted',
          platform: 'ios',
          appVersion: '0.1.0',
        }),
        NOW,
      ),
    ).toEqual({
      id: 'up1',
      sentAt: iso(NOW - HOUR),
      userName: 'Pat Lee',
      type: T.types['ticket.video'],
      place: 'Fix login',
      state: T.states.kept,
      flags: '',
      reason: 'The ticket was deleted',
      updatedAt: iso(NOW - HOUR),
      device: 'ios 0.1.0',
    });
  });

  it('falls back to the target key, the creation time and "Unknown"', () => {
    const row = toSupportRow(
      upload({ label: null, sentAt: null, createdAt: iso(NOW), userName: null }),
      NOW,
    );
    expect(row).toMatchObject({
      place: `ticket:${TICKET}`,
      sentAt: iso(NOW),
      userName: T.unknownPerson,
    });
  });

  it("keeps only the selected team's rows", () => {
    const rows = supportRowsForTeam(
      [
        upload({ id: 'a' }),
        upload({ id: 'b', teamId: 'other' }),
        upload({ id: 'c', teamId: null }),
      ],
      'team1',
      NOW,
    );
    expect(rows.map((row) => row.id)).toEqual(['a']);
  });

  it('says a full page may be missing rows, even when none of them were the team’s', () => {
    const others = Array.from({ length: 4 }, (_, i) => upload({ id: `o${i}`, teamId: 'other' }));
    // A server without the teamId filter filled the page with other teams' rows.
    expect(supportPage(others, 'team1', NOW, 4)).toEqual({ rows: [], incomplete: true });
    const page = supportPage([upload({ id: 'a' }), ...others.slice(1)], 'team1', NOW, 4);
    expect(page.rows.map((row) => row.id)).toEqual(['a']);
    expect(page.incomplete).toBe(true);
    // Fewer rows than the limit: that's every match.
    expect(supportPage([upload({ id: 'a' })], 'team1', NOW, 4)).toMatchObject({
      incomplete: false,
    });
    expect(supportPage([], 'team1', NOW).incomplete).toBe(false);
  });
});

describe('the metrics as text', () => {
  it('reads rates and durations', () => {
    expect(percentText(null)).toBe('–');
    expect(percentText(5 / 11)).toBe('45%');
    expect(durationText(null)).toBe('–');
    expect(durationText(45_000)).toBe('45 s');
    expect(durationText(3 * 60_000)).toBe('3 min');
    expect(durationText(30 * HOUR)).toBe('30 h');
    expect(durationText(72 * HOUR)).toBe('3 d');
  });

  it('lists them in order', () => {
    const metrics: PulseUploadMetrics = {
      teamId: 'team1',
      since: iso(NOW - 30 * 24 * HOUR),
      until: iso(NOW),
      truncated: false,
      counts: {
        total: 12,
        sent: 11,
        canceled: 1,
        inFlight: 3,
        delivered: 5,
        kept: 1,
        failed: 1,
        abandoned: 1,
        overdue: 2,
      },
      rates: { success: 5 / 11, kept: 1 / 11, failed: 1 / 11, abandoned: 1 / 11, overdue: 2 / 11 },
      timeToAttachMs: { count: 5, p50: 3 * 60_000, p95: 30 * HOUR },
      duplicateAttachments: { sets: 0, extra: 0 },
      byType: {},
    };
    expect(metricItems(metrics)).toEqual([
      { label: T.metric.sent, value: '11' },
      { label: T.metric.attached, value: '45%' },
      { label: T.metric.timeToAttach, value: '3 min · 30 h' },
      { label: T.metric.kept, value: '9%' },
      { label: T.metric.failed, value: '9%' },
      { label: T.metric.overdue, value: '18%' },
      { label: T.metric.abandoned, value: '9%' },
      { label: T.metric.duplicates, value: '0' },
    ]);
  });
});
