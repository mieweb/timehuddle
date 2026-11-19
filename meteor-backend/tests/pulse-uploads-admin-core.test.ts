/**
 * Unit tests for the admins' Pulse upload metrics
 * (server/pulse-uploads-admin-core.js): the argument check, the rows'
 * pipeline and the attachments' query, and the math on a fixture team's rows (success
 * rate, time to attach p50/p95, kept / failed / abandoned / overdue rates,
 * duplicate attachments).
 */
import { describe, it, expect } from 'vitest';

import {
  checkMetricsArgs,
  computeMetrics,
  DEFAULT_METRICS_WINDOW_MS,
  duplicateCounts,
  MAX_METRICS_ROWS,
  MAX_METRICS_WINDOW_MS,
  metricsPipeline,
  metricsReport,
  percentile,
  PULSE_UPLOAD_ADMIN_METHODS,
  videoAttachmentsQuery,
  wasOverdue,
} from '../server/pulse-uploads-admin-core';
import { exposePulseUploads, pulseUploadMethods } from '../server/pulse-uploads-expose-core';

const TEAM = 'Tm7xKq2ZpR4sW9aBc';
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 10, 19, 12, 0, 0);

type Row = Record<string, unknown>;
type Checked = { error?: string; reason?: string; value?: { teamId: string; since: Date } };
const SPECS = PULSE_UPLOAD_ADMIN_METHODS as unknown as Parameters<typeof exposePulseUploads>[2];
const check = (args: unknown) => checkMetricsArgs(args, NOW) as Checked;
let seq = 0;

/** A row sent `agoMs` before NOW, begun at Send, landing `tookMs` later when it landed. */
function row(state: string, { agoMs = HOUR, tookMs = null as number | null, type = 'ticket.video', overdueAt = null as Date | null } = {}): Row {
  const sentAt = new Date(NOW - agoMs);
  return {
    _id: `u${(seq += 1)}`,
    type,
    state,
    sentAt,
    createdAt: sentAt,
    deliveredAt: tookMs == null ? null : new Date(sentAt.getTime() + tookMs),
    overdueAt,
  };
}

describe('pulseUploads.metrics schema', () => {
  it('is registered and exposed like the other pulseUploads methods', () => {
    const exposed: string[] = [];
    const methods = pulseUploadMethods(
      { 'pulseUploads.metrics': async () => ({}) },
      { requireIdentity: async () => ({ userId: 'u' }), tooManyRequests: () => new Error('slow down'), specs: SPECS },
    );
    const names = exposePulseUploads({ expose: (name: string) => exposed.push(name) }, methods, SPECS);
    expect(names).toEqual(['pulseUploads.metrics']);
    expect(exposed).toEqual(['pulseUploads.metrics']);
    const spec = PULSE_UPLOAD_ADMIN_METHODS['pulseUploads.metrics'];
    expect(spec.inputSchema.required).toEqual(['teamId']);
    expect(spec.description).toMatch(/Limited to 30 calls per 60 s per user\./);
  });

  it('limits each user to its rate', async () => {
    const methods = pulseUploadMethods(
      { 'pulseUploads.metrics': async () => 'ok' },
      {
        requireIdentity: async () => ({ userId: 'admin' }),
        tooManyRequests: () => new Error('too many'),
        specs: SPECS,
        now: () => NOW,
      },
    );
    const call = methods['pulseUploads.metrics'] as (args: unknown) => Promise<unknown>;
    for (let i = 0; i < 30; i += 1) await expect(call.call({}, { teamId: TEAM })).resolves.toBe('ok');
    await expect(call.call({}, { teamId: TEAM })).rejects.toThrow('too many');
  });
});

describe('checkMetricsArgs', () => {
  it('needs a team', () => {
    expect(check({})).toEqual({ error: 'bad-request', reason: 'teamId is required' });
    expect(check({ teamId: '' }).error).toBe('bad-request');
    expect(check({ teamId: 'x'.repeat(129) }).error).toBe('bad-request');
  });

  it('defaults to the last 30 days', () => {
    expect(check({ teamId: TEAM })).toEqual({
      value: { teamId: TEAM, since: new Date(NOW - DEFAULT_METRICS_WINDOW_MS) },
    });
  });

  it('takes a since, clamped to 90 days, never in the future', () => {
    expect(check({ teamId: TEAM, since: NOW - DAY }).value?.since).toEqual(new Date(NOW - DAY));
    expect(check({ teamId: TEAM, since: 0 }).value?.since).toEqual(new Date(NOW - MAX_METRICS_WINDOW_MS));
    expect(check({ teamId: TEAM, since: NOW + 1 }).error).toBe('bad-request');
    expect(check({ teamId: TEAM, since: '1' }).error).toBe('bad-request');
    expect(check({ teamId: TEAM, since: Number.NaN }).error).toBe('bad-request');
  });
});

describe('metricsPipeline', () => {
  it("reads the team's rows sent in the window, newest first, one past the cap, without keys or tokens", () => {
    const since = new Date(NOW - DAY);
    const [match, sort, limit, project] = metricsPipeline({ teamId: TEAM, since });
    expect(match).toEqual({
      $match: { teamId: TEAM, $or: [{ sentAt: { $gte: since } }, { sentAt: null, createdAt: { $gte: since } }] },
    });
    expect(sort).toEqual({ $sort: { createdAt: -1 } });
    expect(limit).toEqual({ $limit: MAX_METRICS_ROWS + 1 });
    expect(Object.keys(project.$project as object).sort()).toEqual(
      ['_id', 'createdAt', 'deliveredAt', 'overdueAt', 'sentAt', 'state', 'type'].sort(),
    );
  });
});

describe('duplicate attachments', () => {
  it("reads the uploads' video attachments, only the upload each came from", () => {
    expect(videoAttachmentsQuery(['u1', 'u2'])).toEqual({
      filter: { type: 'video', pulseUploadId: { $in: ['u1', 'u2'] } },
      projection: { _id: 0, pulseUploadId: 1 },
    });
  });

  // Every attachment has its own {url, place}, so the unique index
  // (huddle-server §12) lets them all in.
  const attachments = [
    // u1 sent again under a new url, onto the same ticket.
    { pulseUploadId: 'u1', url: '/pulsevault/artifacts/a1/video', attachedTo: { kind: 'ticket', id: 't1' } },
    { pulseUploadId: 'u1', url: '/pulsevault/artifacts/a1b/video', attachedTo: { kind: 'ticket', id: 't1' } },
    // u2 on two tickets, then on a session as well.
    { pulseUploadId: 'u2', url: '/pulsevault/artifacts/a2/video', attachedTo: { kind: 'ticket', id: 't1' } },
    { pulseUploadId: 'u2', url: '/pulsevault/artifacts/a2/video', attachedTo: { kind: 'ticket', id: 't2' } },
    { pulseUploadId: 'u2', url: '/pulsevault/artifacts/a2/video', attachedTo: { kind: 'clock', id: 'c1' } },
    // u3 once.
    { pulseUploadId: 'u3', url: '/pulsevault/artifacts/a3/video', attachedTo: { kind: 'ticket', id: 't1' } },
  ];

  it('counts an upload attached more than once, whatever its url or place', () => {
    const keys = attachments.map(({ url, attachedTo }) => `${url}|${attachedTo.kind}|${attachedTo.id}`);
    expect(new Set(keys).size).toBe(attachments.length);
    expect(duplicateCounts(attachments)).toEqual({ sets: 2, extra: 3 });
  });

  it('reads none, or one each, as zero', () => {
    expect(duplicateCounts([])).toEqual({ sets: 0, extra: 0 });
    expect(duplicateCounts(attachments.slice(-1))).toEqual({ sets: 0, extra: 0 });
    expect(duplicateCounts([{ pulseUploadId: null }, { pulseUploadId: null }, {}])).toEqual({ sets: 0, extra: 0 });
  });
});

describe('percentile (nearest rank)', () => {
  it('picks the value at the rank', () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([7], 95)).toBe(7);
    const values = Array.from({ length: 20 }, (_, i) => (20 - i) * 1000); // 20 s … 1 s, unsorted
    expect(percentile(values, 50)).toBe(10_000);
    expect(percentile(values, 95)).toBe(19_000);
    expect(percentile(values, 100)).toBe(20_000);
  });
});

describe('wasOverdue', () => {
  it('counts a flagged row on its way, and an unswept one past 24 h', () => {
    expect(wasOverdue(row('uploading', { agoMs: 2 * DAY, overdueAt: new Date(NOW - DAY) }), NOW)).toBe(true);
    expect(wasOverdue(row('intent', { agoMs: DAY }), NOW)).toBe(true);
    expect(wasOverdue(row('reserved', { agoMs: DAY - MIN }), NOW)).toBe(false);
  });

  it('counts a video that landed more than 24 h after Send (delivery clears the flag)', () => {
    expect(wasOverdue(row('delivered', { agoMs: 3 * DAY, tookMs: DAY + HOUR }), NOW)).toBe(true);
    expect(wasOverdue(row('kept', { agoMs: 3 * DAY, tookMs: 2 * DAY }), NOW)).toBe(true);
    expect(wasOverdue(row('delivered', { agoMs: 3 * DAY, tookMs: 5 * MIN }), NOW)).toBe(false);
  });

  it('never counts a processing, cancelled, failed or abandoned row', () => {
    for (const state of ['processing', 'canceled', 'failed', 'abandoned']) {
      expect(wasOverdue(row(state, { agoMs: 5 * DAY }), NOW)).toBe(false);
    }
  });
});

describe('computeMetrics on a fixture team', () => {
  // 12 rows: 1 cancelled, so 11 sent.
  const rows = [
    row('delivered', { tookMs: 1 * MIN }),
    row('delivered', { tookMs: 2 * MIN }),
    row('delivered', { tookMs: 3 * MIN }),
    row('delivered', { tookMs: 4 * MIN }),
    row('delivered', { agoMs: 3 * DAY, tookMs: 30 * HOUR, type: 'clock.wrapup' }), // late: overdue
    row('kept', { tookMs: 10 * MIN }),
    row('failed'),
    row('abandoned', { agoMs: 2 * DAY, type: 'clock.wrapup' }),
    row('uploading', { agoMs: 2 * DAY, overdueAt: new Date(NOW - DAY), type: 'clock.wrapup' }), // stuck: overdue
    row('reserved', { agoMs: 10 * MIN }), // on its way
    row('processing', { agoMs: 2 * MIN }), // on its way
    row('canceled'),
  ];
  const metrics = computeMetrics(rows, { now: NOW, duplicates: { sets: 0, extra: 0 } });

  it('counts states, with cancelled rows outside "sent"', () => {
    expect(metrics.counts).toEqual({
      total: 12,
      sent: 11,
      canceled: 1,
      inFlight: 3,
      delivered: 5,
      kept: 1,
      failed: 1,
      abandoned: 1,
      overdue: 2,
    });
  });

  it('gives each rate over sent', () => {
    expect(metrics.rates.success).toBeCloseTo(5 / 11);
    expect(metrics.rates.kept).toBeCloseTo(1 / 11);
    expect(metrics.rates.failed).toBeCloseTo(1 / 11);
    expect(metrics.rates.abandoned).toBeCloseTo(1 / 11);
    expect(metrics.rates.overdue).toBeCloseTo(2 / 11);
  });

  it('times begin → attached over delivered rows only', () => {
    expect(metrics.timeToAttachMs).toEqual({ count: 5, p50: 3 * MIN, p95: 30 * HOUR });
  });

  it('breaks the counts down by type', () => {
    expect(metrics.byType['clock.wrapup']).toMatchObject({ sent: 3, delivered: 1, abandoned: 1, inFlight: 1, overdue: 2 });
    expect(metrics.byType['ticket.video']).toMatchObject({ total: 9, sent: 8, canceled: 1, delivered: 4, overdue: 0 });
  });

  it('passes the duplicate count through', () => {
    expect(metrics.duplicateAttachments).toEqual({ sets: 0, extra: 0 });
    expect(computeMetrics(rows, { now: NOW, duplicates: { sets: 1, extra: 2 } }).duplicateAttachments).toEqual({ sets: 1, extra: 2 });
  });

  it('gives null rates and times when nothing was sent', () => {
    const none = computeMetrics([row('canceled')], { now: NOW });
    expect(none.rates).toEqual({ success: null, kept: null, failed: null, abandoned: null, overdue: null });
    expect(none.timeToAttachMs).toEqual({ count: 0, p50: null, p95: null });
    expect(none.duplicateAttachments).toEqual({ sets: 0, extra: 0 });
  });

  it('leaves out rows in a state the server does not know', () => {
    expect(computeMetrics([row('mystery'), row('delivered', { tookMs: MIN })], { now: NOW }).counts.total).toBe(1);
  });

  it('measures time to attach from the first begin, not a later Send time', () => {
    const begun = row('delivered', { tookMs: 10 * MIN });
    // A re-sent draft: the row was made at the first begin, an hour before this Send.
    begun.createdAt = new Date((begun.sentAt as Date).getTime() - HOUR);
    expect(computeMetrics([begun], { now: NOW }).timeToAttachMs.p50).toBe(HOUR + 10 * MIN);
  });
});

describe('metricsReport', () => {
  it('names the window, and says when it held more rows than were read', () => {
    const since = new Date(NOW - DAY);
    const report = metricsReport({ teamId: TEAM, since, now: NOW, rows: [row('delivered', { tookMs: MIN })] });
    expect(report).toMatchObject({
      teamId: TEAM,
      since: since.toISOString(),
      until: new Date(NOW).toISOString(),
      truncated: false,
      counts: { delivered: 1, sent: 1 },
      duplicateAttachments: { sets: 0, extra: 0 },
    });
    const many = Array.from({ length: MAX_METRICS_ROWS + 1 }, () => ({ _id: 'x', type: 'ticket.video', state: 'failed' }));
    const capped = metricsReport({ teamId: TEAM, since, now: NOW, rows: many });
    expect(capped.truncated).toBe(true);
    expect(capped.counts.total).toBe(MAX_METRICS_ROWS);
  });
});
