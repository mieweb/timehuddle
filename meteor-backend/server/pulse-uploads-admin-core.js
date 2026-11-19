/**
 * Support for Pulse videos sent from the app, with no Meteor or database
 * (huddle-server §5.6, PLAN §7.2 Metrics): `pulseUploads.metrics`' schema and
 * rate limit, the check on its arguments, the aggregation pipelines it runs,
 * and the math on the rows they return. pulse-uploads-admin.js runs them.
 *
 * The metrics come from `pulseUploads` alone (no client telemetry in v1):
 *  - success rate: delivered over sent;
 *  - time to attach (begin → delivered), p50 and p95;
 *  - kept, failed, abandoned and overdue rates;
 *  - duplicate attachments, which must be 0.
 *
 * A duplicate attachment is one upload whose video is attached more than
 * once, whatever its url or place: an artifact sent again under a new url,
 * or the same upload on two tickets or sessions. The unique index on
 * {url, place} (huddle-server §12) can't see either. Only ticket and clock
 * session videos are attachments; a Huddle post's video and a wrap-up's or
 * plan's session post keep theirs on the post, so they aren't counted here.
 *
 * "Failed" rows are places refused at begin; they count for the team the
 * target names (the row's `teamId`, set at the refusal).
 *
 * "Sent" is every row of the team in the window but the cancelled ones: a
 * cancel is the person's choice (Cancel sending, Edit, Delete), not a lost
 * video. Pulse's `needs_credentials` is a state on the phone that the server
 * never sees, so it isn't here.
 */
import { OVERDUE_STATES, PULSE_OVERDUE_AFTER_MS, PULSE_UPLOAD_STATES } from './pulse-uploads-core.js';

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** An admin opening the support section, and its refreshes. */
export const PULSE_METRICS_LIMIT = Object.freeze({ limit: 30, windowMs: MINUTE_MS });

/** The window when the call names none, and the longest one it may ask for. */
export const DEFAULT_METRICS_WINDOW_MS = 30 * DAY_MS;
export const MAX_METRICS_WINDOW_MS = 90 * DAY_MS;

/** Most rows one metrics call reads; `truncated` says when the window held more. */
export const MAX_METRICS_ROWS = 20000;

const limitText = ({ limit, windowMs }) => `Limited to ${limit} calls per ${windowMs / 1000} s per user.`;

const RATE = { type: ['number', 'null'], description: '0–1 of sent; null when nothing was sent' };
const COUNTS = {
  type: 'object',
  properties: {
    total: { type: 'integer' },
    sent: { type: 'integer' },
    canceled: { type: 'integer' },
    inFlight: { type: 'integer' },
    delivered: { type: 'integer' },
    kept: { type: 'integer' },
    failed: { type: 'integer' },
    abandoned: { type: 'integer' },
    overdue: { type: 'integer' },
  },
};

/** The admin methods' schemas and rate limits, in the shape pulse-uploads-expose-core.js registers and exposes. */
export const PULSE_UPLOAD_ADMIN_METHODS = Object.freeze({
  'pulseUploads.metrics': Object.freeze({
    rateLimit: PULSE_METRICS_LIMIT,
    description:
      "How a team's Pulse videos from the app are doing since `since` (default 30 days, at most 90): success rate, time to attach (p50, p95), kept, failed, abandoned and overdue rates, and duplicate attachments (must be 0). Team admins and org owners. " +
      limitText(PULSE_METRICS_LIMIT),
    inputSchema: {
      type: 'object',
      properties: {
        teamId: { type: 'string', maxLength: 128 },
        since: { type: 'number', description: 'ms epoch: rows sent since' },
      },
      required: ['teamId'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        teamId: { type: 'string' },
        since: { type: 'string', format: 'date-time' },
        until: { type: 'string', format: 'date-time' },
        truncated: { type: 'boolean', description: `More than ${MAX_METRICS_ROWS} rows: only the newest were read` },
        counts: COUNTS,
        rates: {
          type: 'object',
          properties: { success: RATE, kept: RATE, failed: RATE, abandoned: RATE, overdue: RATE },
        },
        timeToAttachMs: {
          type: 'object',
          properties: {
            count: { type: 'integer' },
            p50: { type: ['number', 'null'] },
            p95: { type: ['number', 'null'] },
          },
        },
        duplicateAttachments: {
          type: 'object',
          properties: {
            sets: { type: 'integer', description: 'Uploads whose video is attached more than once' },
            extra: { type: 'integer', description: 'Copies beyond the first: must be 0' },
          },
        },
        byType: { type: 'object', additionalProperties: COUNTS },
      },
    },
  }),
});

// ─── Arguments ───────────────────────────────────────────────────────────────

const badRequest = (reason) => ({ error: 'bad-request', reason });

/**
 * `pulseUploads.metrics`' arguments at `now` (ms): `{ value: { teamId, since } }`,
 * `since` a Date no earlier than 90 days back, or a refusal.
 */
export function checkMetricsArgs(args, now) {
  const teamId = args?.teamId;
  if (typeof teamId !== 'string' || !teamId || teamId.length > 128) return badRequest('teamId is required');
  let since = now - DEFAULT_METRICS_WINDOW_MS;
  if (args.since != null) {
    if (typeof args.since !== 'number' || !Number.isFinite(args.since)) return badRequest('Invalid since');
    if (args.since > now) return badRequest('since is in the future');
    since = Math.max(args.since, now - MAX_METRICS_WINDOW_MS);
  }
  return { value: { teamId, since: new Date(since) } };
}

// ─── Pipelines ───────────────────────────────────────────────────────────────

/** What the math reads of a row. No keys, tokens or artifacts. */
export const METRICS_FIELDS = Object.freeze({
  _id: 1,
  type: 1,
  state: 1,
  sentAt: 1,
  createdAt: 1,
  deliveredAt: 1,
  overdueAt: 1,
});

/**
 * The aggregation over `pulseUploads` for a team's rows sent since `since`
 * (a row with no `sentAt` counts from `createdAt`, as the overdue sweep does),
 * newest first, at most `limit` (one more than MAX_METRICS_ROWS, so the
 * caller can tell the window held more).
 * @param {{ teamId: string, since: Date, limit?: number }} args
 */
export function metricsPipeline({ teamId, since, limit = MAX_METRICS_ROWS + 1 }) {
  return [
    {
      $match: {
        teamId,
        $or: [{ sentAt: { $gte: since } }, { sentAt: null, createdAt: { $gte: since } }],
      },
    },
    { $sort: { createdAt: -1 } },
    { $limit: limit },
    { $project: { ...METRICS_FIELDS } },
  ];
}

/**
 * The `attachments` find for the video attachments of `uploadIds`: its
 * filter, and a projection to the upload each came from (all
 * duplicateCounts reads).
 * @param {string[]} uploadIds
 */
export function videoAttachmentsQuery(uploadIds) {
  return {
    filter: { type: 'video', pulseUploadId: { $in: [...uploadIds] } },
    projection: { _id: 0, pulseUploadId: 1 },
  };
}

/**
 * The duplicates among video attachments (videoAttachmentsQuery's): `sets`,
 * the uploads attached more than once, and `extra`, the copies beyond each
 * one's first. Both must be 0.
 * @param {Array<{ pulseUploadId?: unknown }>} attachments
 */
export function duplicateCounts(attachments) {
  /** @type {Map<string, number>} */
  const perUpload = new Map();
  for (const attachment of Array.isArray(attachments) ? attachments : []) {
    const id = attachment?.pulseUploadId;
    if (typeof id !== 'string' || !id) continue;
    perUpload.set(id, (perUpload.get(id) ?? 0) + 1);
  }
  let sets = 0;
  let extra = 0;
  for (const n of perUpload.values()) {
    if (n < 2) continue;
    sets += 1;
    extra += n - 1;
  }
  return { sets, extra };
}

// ─── Math ────────────────────────────────────────────────────────────────────

const ms = (value) => (value == null ? null : new Date(value).getTime());

/** When the row's video was sent: `sentAt`, or `createdAt` for a row without one. */
const sentMs = (row) => ms(row.sentAt) ?? ms(row.createdAt);

/**
 * Whether the row's video was ever overdue at `now`: flagged by the sweep and
 * still on its way, past 24 h and not swept yet, or landed more than 24 h
 * after Send (delivery clears the flag, so a late arrival counts this way).
 */
export function wasOverdue(row, now) {
  const since = sentMs(row);
  if (row.state === 'delivered' || row.state === 'kept') {
    const landed = ms(row.deliveredAt);
    return since != null && landed != null && landed - since >= PULSE_OVERDUE_AFTER_MS;
  }
  if (!OVERDUE_STATES.includes(row.state)) return false;
  if (row.overdueAt != null) return true;
  return since != null && now - since >= PULSE_OVERDUE_AFTER_MS;
}

/**
 * The nearest-rank percentile `p` (0–100) of `values`, or null for none.
 * @param {number[]} values
 * @param {number} p
 */
export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

const IN_FLIGHT = new Set(['intent', 'reserved', 'uploading', 'processing']);

function emptyCounts() {
  return { total: 0, sent: 0, canceled: 0, inFlight: 0, delivered: 0, kept: 0, failed: 0, abandoned: 0, overdue: 0 };
}

function count(counts, row, now) {
  counts.total += 1;
  if (row.state === 'canceled') {
    counts.canceled += 1;
    return;
  }
  counts.sent += 1;
  if (IN_FLIGHT.has(row.state)) counts.inFlight += 1;
  else if (Object.hasOwn(counts, row.state)) counts[row.state] += 1;
  if (wasOverdue(row, now)) counts.overdue += 1;
}

const rateOf = (part, whole) => (whole > 0 ? part / whole : null);

/**
 * The metrics for `rows` (METRICS_FIELDS of a team's rows in the window) at
 * `now` (ms). Rows in a state the server doesn't know are left out.
 * `timeToAttachMs` is begin (`createdAt`) → delivered, for delivered rows.
 * @param {Array<Record<string, any>>} rows
 * @param {{ now: number, duplicates?: { sets: number, extra: number } }} options
 */
export function computeMetrics(rows, { now, duplicates = { sets: 0, extra: 0 } }) {
  const counts = emptyCounts();
  /** @type {Record<string, ReturnType<typeof emptyCounts>>} */
  const byType = {};
  const attachTimes = [];
  for (const row of rows) {
    if (!PULSE_UPLOAD_STATES.includes(row.state)) continue;
    count(counts, row, now);
    const type = typeof row.type === 'string' ? row.type : 'unknown';
    byType[type] ??= emptyCounts();
    count(byType[type], row, now);
    if (row.state === 'delivered') {
      const begun = ms(row.createdAt) ?? sentMs(row);
      const landed = ms(row.deliveredAt);
      if (begun != null && landed != null && landed >= begun) attachTimes.push(landed - begun);
    }
  }
  return {
    counts,
    rates: {
      success: rateOf(counts.delivered, counts.sent),
      kept: rateOf(counts.kept, counts.sent),
      failed: rateOf(counts.failed, counts.sent),
      abandoned: rateOf(counts.abandoned, counts.sent),
      overdue: rateOf(counts.overdue, counts.sent),
    },
    timeToAttachMs: { count: attachTimes.length, p50: percentile(attachTimes, 50), p95: percentile(attachTimes, 95) },
    duplicateAttachments: { sets: duplicates.sets, extra: duplicates.extra },
    byType,
  };
}

/**
 * `pulseUploads.metrics`' answer for what the pipelines returned: the window,
 * whether it held more rows than were read, and computeMetrics.
 * @param {{ teamId: string, since: Date, now: number, rows: Array<Record<string, any>>, duplicates?: { sets: number, extra: number } }} args
 */
export function metricsReport({ teamId, since, now, rows, duplicates }) {
  const truncated = rows.length > MAX_METRICS_ROWS;
  const read = truncated ? rows.slice(0, MAX_METRICS_ROWS) : rows;
  return {
    teamId,
    since: since.toISOString(),
    until: new Date(now).toISOString(),
    truncated,
    ...computeMetrics(read, { now, duplicates }),
  };
}
