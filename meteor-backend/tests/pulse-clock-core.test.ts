/**
 * Unit tests for pulse-clock-core (server/pulse-clock-core.js): clocking in
 * or out at Send with a Pulse video. Rows and posts are plain objects in
 * place of the collections.
 */
import { describe, it, expect } from 'vitest';

import {
  checkClockCallArgs,
  clockActionTime,
  clockCallSteps,
  firstClockRow,
  isSessionPost,
  markedPostOf,
  missingVideoWrite,
  planPostOptions,
  publicVideoMarks,
  PULSE_CLOCK_CALLS,
  PULSE_CLOCK_METHODS,
  videoMark,
  wrapUpLine,
  wrapUpOptions,
} from '../server/pulse-clock-core';
import { intentDecision, PULSE_MAX_UPLOAD_BYTES } from '../server/pulse-uploads-core';
import { exposePulseUploads, pulseUploadMethods } from '../server/pulse-uploads-expose-core';

// The registration helpers are typed by the pulseUploads table they default to.
const CLOCK_SPECS = PULSE_CLOCK_METHODS as unknown as Parameters<typeof exposePulseUploads>[2];

const USER = 'user1';
const TEAM = '64b000000000000000000001';
const SESSION = '64b0000000000000000000AA';
const DRAFT = 'inst-1:draft-1';
const NOW = Date.UTC(2026, 10, 18, 17, 30);
const MINUTE = 60 * 1000;

const stopArgs = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  teamId: TEAM,
  clockEventId: SESSION,
  postDate: '2026-11-18',
  at: NOW - 2 * MINUTE,
  draftKey: DRAFT,
  bytes: 10 * 1024 * 1024,
  name: 'Shipped the login fix',
  ...extra,
});
const startArgs = (extra: Record<string, unknown> = {}) => {
  const args = stopArgs(extra);
  delete args.clockEventId;
  return args;
};

function stopValue(extra: Record<string, unknown> = {}) {
  const checked = checkClockCallArgs('clock.stopWithVideo', USER, stopArgs(extra));
  if (!checked.value) throw new Error(`refused: ${checked.reason}`);
  return checked.value;
}
function startValue(extra: Record<string, unknown> = {}) {
  const checked = checkClockCallArgs('clock.startWithPlan', USER, startArgs(extra));
  if (!checked.value) throw new Error(`refused: ${checked.reason}`);
  return checked.value;
}

const intentRow = (extra: Record<string, unknown> = {}) => ({
  _id: 'upload-1',
  userId: USER,
  clientKey: null,
  draftKey: DRAFT,
  type: 'clock.wrapup',
  target: { kind: 'clock', id: SESSION.toLowerCase() },
  targetKey: `clock:${SESSION.toLowerCase()}`,
  destination: { kind: 'session-post', postId: null, role: 'wrapup' },
  postId: null,
  clockEventId: SESSION.toLowerCase(),
  sentAt: new Date(NOW - 2 * MINUTE),
  fallback: null,
  state: 'intent',
  createdAt: new Date(NOW),
  updatedAt: new Date(NOW),
  ...extra,
});

const planPost = (extra: Record<string, unknown> = {}) => ({
  _id: 'post-plan',
  userId: USER,
  teamId: TEAM,
  clockEventId: SESSION.toLowerCase(),
  createdAt: new Date(NOW - 60 * MINUTE),
  ...extra,
});
const updatePost = (extra: Record<string, unknown> = {}) => ({
  _id: 'post-update',
  userId: USER,
  teamId: TEAM,
  clockEventId: SESSION.toLowerCase(),
  sessionUpdate: true,
  createdAt: new Date(NOW - 30 * MINUTE),
  ...extra,
});

describe('checkClockCallArgs', () => {
  it('takes a wrap-up: the row it will make, keyed by the session', () => {
    const value = stopValue();
    expect(value).toMatchObject({
      type: 'clock.wrapup',
      clock: 'stop',
      role: 'wrapup',
      teamId: TEAM,
      clockEventId: SESSION.toLowerCase(),
      target: { kind: 'clock', id: SESSION.toLowerCase() },
      targetKey: `clock:${SESSION.toLowerCase()}`,
      draftKey: DRAFT,
      name: 'Shipped the login fix',
    });
  });

  it('takes a plan: keyed by the team and day, as begin names it', () => {
    const value = startValue();
    expect(value).toMatchObject({
      type: 'clock.plan',
      clock: 'start',
      clockEventId: null,
      target: { kind: 'clock-plan', teamId: TEAM.toLowerCase(), postDate: '2026-11-18' },
      targetKey: `clock-plan:${TEAM.toLowerCase()}:2026-11-18`,
    });
  });

  it('refuses a too-large video before anything else is looked at (O15)', () => {
    const checked = checkClockCallArgs('clock.stopWithVideo', USER, stopArgs({ bytes: PULSE_MAX_UPLOAD_BYTES + 1 }));
    expect(checked).toMatchObject({ error: 'too-large' });
    expect(checkClockCallArgs('clock.stopWithVideo', USER, stopArgs({ bytes: PULSE_MAX_UPLOAD_BYTES })).value).toBeTruthy();
  });

  it('refuses missing or malformed arguments', () => {
    const bad = (name: string, args: unknown) => checkClockCallArgs(name, USER, args).error;
    expect(bad('clock.stopWithVideo', stopArgs({ clockEventId: undefined }))).toBe('bad-request');
    expect(bad('clock.stopWithVideo', stopArgs({ clockEventId: 'nope' }))).toBe('bad-request');
    expect(bad('clock.stopWithVideo', stopArgs({ teamId: '' }))).toBe('bad-request');
    expect(bad('clock.stopWithVideo', stopArgs({ postDate: '18/11/2026' }))).toBe('bad-request');
    expect(bad('clock.stopWithVideo', stopArgs({ at: 'now' }))).toBe('bad-request');
    expect(bad('clock.stopWithVideo', stopArgs({ draftKey: 'inst-1:draft-1:0123456789abcdef' }))).toBe('bad-request');
    expect(bad('clock.stopWithVideo', stopArgs({ bytes: -1 }))).toBe('bad-request');
    expect(bad('clock.stopWithVideo', stopArgs({ name: 42 }))).toBe('bad-request');
    expect(bad('clock.stopWithVideo', null)).toBe('bad-request');
    expect(bad('clock.start', stopArgs())).toBe('bad-request');
  });

  it('needs no session for a plan', () => {
    expect(checkClockCallArgs('clock.startWithPlan', USER, startArgs()).value).toBeTruthy();
  });
});

describe('idempotency by draftKey', () => {
  it('a fresh draft gets an intent row; the same draftKey again is a repeat, edited or not', () => {
    const value = stopValue();
    expect(intentDecision([], value)).toMatchObject({ action: 'insert', state: 'intent' });
    const row = intentRow({ postId: 'post-plan', state: 'reserved', clientKey: `${DRAFT}:0123456789abcdef` });
    expect(intentDecision([row], value)).toMatchObject({ action: 'repeat', row });
    // An Edit's later Send names the same draft: still the first call's row.
    expect(intentDecision([row], stopValue({ name: 'Edited name', at: NOW }))).toMatchObject({ action: 'repeat', row });
  });

  it('refuses the draft for another session, or once it went without its clock action', () => {
    const row = intentRow();
    const other = stopValue({ clockEventId: '64b0000000000000000000bb' });
    expect(intentDecision([row], other)).toMatchObject({ action: 'conflict' });
    const fallback = intentRow({ fallback: 'no-clock-action', state: 'reserved' });
    expect(intentDecision([fallback], stopValue())).toMatchObject({ action: 'conflict' });
  });

  it('two rows made at once: both calls keep the oldest', () => {
    const older = intentRow({ _id: 'b', createdAt: new Date(NOW) });
    const newer = intentRow({ _id: 'a', createdAt: new Date(NOW + 1) });
    expect(firstClockRow([newer, older])).toBe(older);
    expect(firstClockRow([older, newer])).toBe(older);
    // Same instant: the lower id, whichever order the database returns them in.
    const twin = intentRow({ _id: 'a', createdAt: new Date(NOW) });
    expect(firstClockRow([older, twin])).toBe(twin);
    expect(firstClockRow([twin, older])).toBe(twin);
    expect(firstClockRow([intentRow({ fallback: 'no-clock-action' })])).toBeNull();
    expect(firstClockRow([])).toBeNull();
  });
});

describe('clockCallSteps', () => {
  const open = { _id: SESSION, endTime: null };
  const ended = { _id: SESSION, endTime: NOW - 2 * MINUTE };

  it('fresh: every step', () => {
    expect(clockCallSteps('stop', { row: null, posts: [], session: open })).toEqual({
      steps: ['intent', 'post', 'clock'],
      postId: null,
    });
    expect(clockCallSteps('start', { row: null, posts: [] })).toEqual({ steps: ['intent', 'post', 'clock'], postId: null });
  });

  it('a row but nothing written: the post and the clock', () => {
    expect(clockCallSteps('stop', { row: intentRow(), posts: [], session: open }).steps).toEqual(['post', 'clock']);
  });

  it('the line written but the row never told (the call stopped there): found by its mark, not written again', () => {
    const row = intentRow();
    const post = planPost({ pendingVideos: [videoMark(row._id, 'wrapup', NOW)] });
    expect(clockCallSteps('stop', { row, posts: [post], session: open })).toEqual({ steps: ['clock'], postId: 'post-plan' });
  });

  it('the line written and recorded, the clock-out failed: only the clock', () => {
    const row = intentRow({ postId: 'post-plan' });
    expect(clockCallSteps('stop', { row, posts: [planPost()], session: open })).toEqual({
      steps: ['clock'],
      postId: 'post-plan',
    });
  });

  it('complete: nothing left, and it answers with the same post', () => {
    const row = intentRow({ postId: 'post-plan', state: 'delivered' });
    expect(clockCallSteps('stop', { row, posts: [planPost()], session: ended })).toEqual({ steps: [], postId: 'post-plan' });
  });

  it('a session ended by hand meanwhile is not ended again', () => {
    const row = intentRow({ postId: 'post-plan' });
    expect(clockCallSteps('stop', { row, posts: [planPost()], session: ended }).steps).toEqual([]);
  });

  it('a video marked missing still counts as written (its post said so already)', () => {
    const row = intentRow({ state: 'canceled' });
    const post = planPost({ missingVideos: [videoMark(row._id, 'wrapup', NOW)] });
    expect(clockCallSteps('stop', { row, posts: [post], session: ended })).toEqual({ steps: [], postId: 'post-plan' });
  });

  it('a deleted post is written again', () => {
    const row = intentRow({ postId: 'post-gone' });
    expect(clockCallSteps('stop', { row, posts: [], session: ended }).steps).toEqual(['post']);
  });

  it('a plan: clocked in once clockStart linked its post', () => {
    const row = intentRow({ type: 'clock.plan', postId: 'post-plan' });
    expect(clockCallSteps('start', { row, posts: [planPost({ clockEventId: undefined })] }).steps).toEqual(['clock']);
    expect(clockCallSteps('start', { row, posts: [planPost()] })).toEqual({ steps: [], postId: 'post-plan' });
    // Made again after the first was deleted: linked by clocking in again (reuseOpen).
    const relinked = intentRow({ type: 'clock.plan', postId: 'post-gone', clockEventId: SESSION });
    expect(clockCallSteps('start', { row: relinked, posts: [] }).steps).toEqual(['post', 'clock']);
  });
});

describe("#854's session-post rules", () => {
  it('an update post is never the plan/wrap-up post; a draft neither', () => {
    expect(isSessionPost(planPost())).toBe(true);
    expect(isSessionPost(updatePost())).toBe(false);
    expect(isSessionPost(planPost({ status: 'draft' }))).toBe(false);
    expect(isSessionPost(null)).toBe(false);
  });

  it('the wrap-up target is the plan or session post, never an update post', () => {
    const row = intentRow({ postId: 'post-update' });
    const update = updatePost({ pendingVideos: [videoMark(row._id, 'wrapup', NOW)] });
    expect(markedPostOf(row, [update])).toBeNull();
    const plan = planPost({ pendingVideos: [videoMark(row._id, 'wrapup', NOW)] });
    expect(markedPostOf(row, [update, plan])).toBe(plan);
  });

  it("an update post never satisfies the plan gate: a wrap-up there is written again on the session's post", () => {
    const row = intentRow({ postId: 'post-update' });
    const update = updatePost({ wrapUpAt: new Date(NOW), pendingVideos: [videoMark(row._id, 'wrapup', NOW)] });
    expect(clockCallSteps('stop', { row, posts: [update], session: { endTime: null } }).steps).toEqual(['post', 'clock']);
  });

  it("the plan post never carries sessionUpdate, a session or joinOpenSession (clockStart links it as the plan)", () => {
    const options = planPostOptions(startValue(), 'upload-1', NOW);
    expect(options).not.toHaveProperty('sessionUpdate');
    expect(options).not.toHaveProperty('clockEventId');
    expect(options).not.toHaveProperty('joinOpenSession');
    expect(options).not.toHaveProperty('wrapUp');
    expect(options).toEqual({
      teamId: TEAM,
      content: { text: 'Shipped the login fix', mentions: [] },
      attachments: [],
      postDate: '2026-11-18',
      pendingVideos: [{ uploadId: 'upload-1', role: 'plan', at: new Date(NOW) }],
    });
    expect(planPostOptions(startValue({ name: null }), 'upload-1', NOW).content.text).toBe('');
  });

  it('the wrap-up goes to the session by id with the line, no attachment, and the video expected', () => {
    expect(wrapUpOptions(stopValue(), 'upload-1', NOW)).toEqual({
      teamId: TEAM,
      clockEventId: SESSION.toLowerCase(),
      postDate: '2026-11-18',
      line: '**Wrap-up:** Shipped the login fix',
      attachment: null,
      pendingVideo: { uploadId: 'upload-1', role: 'wrapup', at: new Date(NOW) },
    });
  });
});

describe('wrapUpLine', () => {
  it("is today's words: with the draft's name, or bare", () => {
    expect(wrapUpLine('Shipped it')).toBe('**Wrap-up:** Shipped it');
    expect(wrapUpLine(null)).toBe('**Wrap-up**');
    expect(wrapUpLine('   ')).toBe('**Wrap-up**');
  });
});

describe('clockActionTime', () => {
  it('is `at` within 30 minutes of the server, and now beyond it or ahead of it', () => {
    expect(clockActionTime(NOW - 2 * MINUTE, NOW)).toBe(NOW - 2 * MINUTE);
    expect(clockActionTime(NOW - 30 * MINUTE, NOW)).toBe(NOW - 30 * MINUTE);
    expect(clockActionTime(NOW - 31 * MINUTE, NOW)).toBe(NOW);
    expect(clockActionTime(NOW + 10 * MINUTE, NOW)).toBe(NOW);
    expect(clockActionTime(Number.NaN, NOW)).toBe(NOW);
  });
});

describe('missingVideoWrite', () => {
  const toPostId = (id: string) => `oid(${id})`;

  it('a cancelled or deleted clock video moves from pending to missing on its post, once', () => {
    const row = intentRow({ postId: 'post-plan', destination: { kind: 'session-post', postId: 'post-plan', role: 'wrapup' } });
    const write = missingVideoWrite({ row, to: 'canceled', reason: 'canceled' }, { toPostId });
    expect(write).toEqual({
      filter: {
        userId: USER,
        $or: [{ _id: 'oid(post-plan)' }, { 'pendingVideos.uploadId': 'upload-1' }],
        'missingVideos.uploadId': { $ne: 'upload-1' },
      },
      update: {
        $pull: { pendingVideos: { uploadId: 'upload-1' } },
        $push: { missingVideos: { uploadId: 'upload-1', role: 'wrapup', at: new Date(NOW - 2 * MINUTE) } },
      },
    });
    expect(missingVideoWrite({ row, to: 'abandoned', reason: 'deleted' }, { toPostId })).not.toBeNull();
  });

  it('a row that never recorded its post finds it by its mark', () => {
    const write = missingVideoWrite({ row: intentRow(), to: 'abandoned', reason: 'deleted' });
    expect(write!.filter).toEqual({
      userId: USER,
      'pendingVideos.uploadId': 'upload-1',
      'missingVideos.uploadId': { $ne: 'upload-1' },
    });
  });

  it('a plan says plan', () => {
    const row = intentRow({ type: 'clock.plan', destination: { kind: 'session-post', postId: 'p', role: 'plan' } });
    expect(missingVideoWrite({ row, to: 'canceled', reason: 'canceled' })!.update.$push.missingVideos.role).toBe('plan');
  });

  it('marks nothing for other rows, an Edit, or a move that is not a stop', () => {
    const ticket = { ...intentRow(), type: 'ticket.video', destination: { kind: 'ticket', id: 'x' } };
    expect(missingVideoWrite({ row: ticket, to: 'canceled', reason: 'canceled' })).toBeNull();
    const fallback = intentRow({ fallback: 'no-clock-action', destination: { kind: 'clock', id: SESSION } });
    expect(missingVideoWrite({ row: fallback, to: 'canceled', reason: 'canceled' })).toBeNull();
    expect(missingVideoWrite({ row: intentRow(), to: 'canceled', reason: 'edited' })).toBeNull();
    expect(missingVideoWrite({ row: intentRow(), to: 'delivered', reason: 'canceled' })).toBeNull();
  });
});

describe('publicVideoMarks', () => {
  it('shows uploadId, role and ISO times only, and always an array', () => {
    const at = new Date(NOW);
    expect(
      publicVideoMarks([
        { uploadId: 'u1', role: 'wrapup', at, draftKey: 'secret' },
        { uploadId: 'u2', role: 'plan', at, overdueAt: new Date(NOW + 1) },
        { role: 'plan' },
        null,
      ]),
    ).toEqual([
      { uploadId: 'u1', role: 'wrapup', at: at.toISOString() },
      { uploadId: 'u2', role: 'plan', at: at.toISOString(), overdueAt: new Date(NOW + 1).toISOString() },
    ]);
    expect(publicVideoMarks(undefined)).toEqual([]);
  });
});

describe('the methods', () => {
  it('both calls are registered with a schema and a rate limit, and exposed', () => {
    const handlers = Object.fromEntries(Object.keys(PULSE_CLOCK_CALLS).map((name) => [name, async () => name]));
    const methods = pulseUploadMethods(handlers, {
      requireIdentity: async () => ({ userId: USER }),
      tooManyRequests: () => new Error('too many'),
      specs: CLOCK_SPECS,
    });
    const exposed: string[] = [];
    const wormhole = { expose: (name: string, spec: { inputSchema: { required: string[] } }) => {
      exposed.push(name);
      expect(spec.inputSchema.required).toEqual(expect.arrayContaining(['teamId', 'postDate', 'at', 'draftKey']));
    } };
    expect(exposePulseUploads(wormhole, methods, CLOCK_SPECS)).toEqual(['clock.stopWithVideo', 'clock.startWithPlan']);
    expect(exposed).toEqual(['clock.stopWithVideo', 'clock.startWithPlan']);
    expect(PULSE_CLOCK_METHODS['clock.stopWithVideo'].inputSchema.required).toContain('clockEventId');
  });

  it('a caller over 30 calls a minute is refused', async () => {
    const methods = pulseUploadMethods(
      Object.fromEntries(Object.keys(PULSE_CLOCK_CALLS).map((name) => [name, async () => 'ok'])),
      {
        requireIdentity: async () => ({ userId: USER }),
        tooManyRequests: () => new Error('too many'),
        specs: CLOCK_SPECS,
        now: () => NOW,
      },
    );
    const call = methods['clock.stopWithVideo'] as (args: unknown) => Promise<unknown>;
    for (let i = 0; i < 30; i += 1) await expect(call.call({}, {})).resolves.toBe('ok');
    await expect(call.call({}, {})).rejects.toThrow('too many');
  });
});
