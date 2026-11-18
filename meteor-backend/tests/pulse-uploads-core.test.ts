/**
 * Unit tests for pulse-uploads-core (server/pulse-uploads-core.js): the rules
 * of the server's record of each in-app Pulse video, with rows as plain
 * objects in place of the collection.
 */
import { describe, it, expect } from 'vitest';

import {
  beginDecision,
  checkBeginArgs,
  draftKeyOf,
  hookDecision,
  intentDecision,
  isClientKey,
  isDraftKey,
  isOverdue,
  nextState,
  overdueQuery,
  PULSE_MAX_UPLOAD_BYTES,
  PULSE_OVERDUE_AFTER_MS,
  PULSE_UPLOAD_STATES,
  selectOverdue,
  sendContextRule,
  sendTime,
  serverErrorToPulseCode,
  uploadSizeRefusal,
} from '../server/pulse-uploads-core';

const NOW = Date.UTC(2026, 10, 18, 17, 2);
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const USER = 'Us9dF2gH4jK6lZ8xC';
const TEAM = 'Tm7xKq2ZpR4sW9aBc';
const TICKET = 'a'.repeat(24);
const OTHER_TICKET = 'b'.repeat(24);
const SESSION = 'c'.repeat(24);
const DRAFT = '7f9c2ba4-e88f-4b2a-9d3e-1c2b3a4d5e6f:0b8e2c1a-3f4d-4e5a-9b6c-7d8e9f0a1b2c';
const KEY_A = `${DRAFT}:0123456789abcdef`; // the first export of the draft
const KEY_B = `${DRAFT}:fedcba9876543210`; // the export after an Edit

type Row = Record<string, unknown>;
type Args = Record<string, unknown>;

/** checkBeginArgs's value for a begin, or the test fails. */
function begin(overrides: Args = {}): Args {
  const checked = checkBeginArgs(
    USER,
    {
      clientKey: KEY_A,
      draftKey: DRAFT,
      type: 'ticket.video',
      target: { kind: 'ticket', id: TICKET },
      sentAt: NOW - MIN,
      bytes: 10_000_000,
      ...overrides,
    },
    NOW,
  );
  if (!('value' in checked) || !checked.value) throw new Error(`refused: ${JSON.stringify(checked)}`);
  return checked.value;
}

let ids = 0;
/** A stored row, as pulse-uploads.js would have written it. */
function row(fields: Row = {}): Row {
  ids += 1;
  return {
    _id: `upload-${ids}`,
    userId: USER,
    draftKey: DRAFT,
    clientKey: KEY_A,
    type: 'ticket.video',
    target: { kind: 'ticket', id: TICKET },
    targetKey: `ticket:${TICKET}`,
    artifactId: `artifact-${ids}`,
    replacedArtifactIds: [],
    state: 'reserved',
    fallback: null,
    sentAt: new Date(NOW - HOUR),
    createdAt: new Date(NOW - HOUR),
    updatedAt: new Date(NOW - HOUR),
    ...fields,
  };
}

/** The intent row a clock call at Send makes: no clientKey, no artifact. */
function wrapupIntent(fields: Row = {}): Row {
  return row({
    clientKey: null,
    artifactId: null,
    type: 'clock.wrapup',
    target: { kind: 'clock', id: SESSION },
    targetKey: `clock:${SESSION}`,
    state: 'intent',
    postId: 'post-1',
    clockEventId: SESSION,
    ...fields,
  });
}

const wrapupBegin = (overrides: Args = {}) =>
  begin({ type: 'clock.wrapup', target: { kind: 'clock', id: SESSION }, ...overrides });

describe('keys', () => {
  it('takes a clientKey of its draftKey plus 16 hex', () => {
    expect(isDraftKey(DRAFT)).toBe(true);
    expect(isClientKey(KEY_A)).toBe(true);
    expect(draftKeyOf(KEY_A)).toBe(DRAFT);
    expect(draftKeyOf(KEY_B)).toBe(DRAFT);
  });

  it('refuses keys of another shape', () => {
    for (const bad of [DRAFT, `${DRAFT}:xyz`, `${DRAFT}:0123456789abcde`, `a:b:c:0123456789abcdef`, 'a b:c:0123456789abcdef', 7]) {
      expect(isClientKey(bad), String(bad)).toBe(false);
    }
    for (const bad of ['only-one-part', 'a:b:c', ':b', 'a:', 'a/b:c', null]) {
      expect(isDraftKey(bad), String(bad)).toBe(false);
    }
    expect(draftKeyOf('nope')).toBeNull();
  });
});

describe('sendTime', () => {
  it.each([
    ['a recent Send', NOW - 5 * MIN, NOW - 5 * MIN],
    ['a Send 7 days ago', NOW - 7 * DAY, NOW - 7 * DAY],
    ['a Send older than 7 days, held to 7', NOW - 9 * DAY, NOW - 7 * DAY],
    ['a phone 20 s fast', NOW + 20_000, NOW],
    ['a phone 30 s fast', NOW + 30_000, NOW],
    ['a phone an hour fast', NOW + HOUR, NOW],
    ['no time', undefined, NOW],
    ['not a time', Number.NaN, NOW],
    ['a string', String(NOW - MIN), NOW],
  ])('%s', (_name, sentAt, expected) => {
    expect(sendTime(sentAt, NOW)).toBe(expected);
  });
});

describe('sendContextRule', () => {
  it('finds the session at begin within 5 minutes of Send, as of Send after', () => {
    expect(sendContextRule(NOW, NOW)).toBe('at-begin');
    expect(sendContextRule(NOW - 5 * MIN, NOW)).toBe('at-begin');
    expect(sendContextRule(NOW - 5 * MIN - 1, NOW)).toBe('as-of-sent');
    expect(sendContextRule(NOW - 3 * HOUR, NOW)).toBe('as-of-sent');
  });
});

describe('checkBeginArgs', () => {
  it('normalises the target, builds its key and clamps sentAt', () => {
    const value = begin({ target: { kind: 'ticket', id: TICKET.toUpperCase() }, sentAt: NOW - 30 * DAY });
    expect(value).toMatchObject({
      target: { kind: 'ticket', id: TICKET },
      targetKey: `ticket:${TICKET}`,
      sentAt: NOW - 7 * DAY,
      renew: false,
      name: null,
    });
  });

  it('builds the day-scoped key of a plan', () => {
    const value = begin({ type: 'clock.plan', target: { kind: 'clock-plan', teamId: TEAM, postDate: '2026-11-18' } });
    expect(value.targetKey).toBe('clock-plan:tm7xkq2zpr4sw9abc:2026-11-18');
  });

  it('reads artifactGone as renewArtifact', () => {
    expect(begin({ artifactGone: true }).renew).toBe(true);
    expect(begin({ renewArtifact: true }).renew).toBe(true);
  });

  it.each([
    ['no arguments', null],
    ['a clientKey of another draft', { clientKey: `other:draft:0123456789abcdef` }],
    ['a bad clientKey', { clientKey: 'nope' }],
    ['an unknown type', { type: 'clock-wrapup' }],
    ['a target of another kind', { type: 'clock.session' }],
    ['a target without its id', { target: { kind: 'ticket' } }],
    ['no sentAt', { sentAt: undefined }],
    ['negative bytes', { bytes: -1 }],
    ['a renew flag that is not a flag', { renewArtifact: 'yes' }],
    ['a name that is not text', { name: 7 }],
  ])('refuses %s as bad-request', (_name, overrides) => {
    const args =
      overrides === null
        ? null
        : {
            clientKey: KEY_A,
            draftKey: DRAFT,
            type: 'ticket.video',
            target: { kind: 'ticket', id: TICKET },
            sentAt: NOW,
            ...overrides,
          };
    expect(checkBeginArgs(USER, args, NOW)).toMatchObject({ error: 'bad-request' });
  });

  it('keeps only the client facts it knows', () => {
    expect(begin({ client: { appVersion: '2.8.0', contractVersion: '1.1', platform: 'web', x: 1 } }).client).toEqual({
      appVersion: '2.8.0',
      contractVersion: '1.1',
      platform: null,
    });
  });
});

describe('uploadSizeRefusal', () => {
  it('refuses above 500 MB, not at it, and passes an unknown size', () => {
    expect(uploadSizeRefusal('ticket.video', PULSE_MAX_UPLOAD_BYTES)).toBeNull();
    expect(uploadSizeRefusal('ticket.video', PULSE_MAX_UPLOAD_BYTES + 1)).toMatchObject({ error: 'too-large' });
    expect(uploadSizeRefusal('clock.wrapup', null)).toBeNull();
  });
});

describe('nextState', () => {
  // [from, event, to]; from null is no row yet, to null is refused.
  const TABLE: Array<[string | null, Record<string, unknown>, string | null]> = [
    [null, { type: 'intent' }, 'intent'],
    ['intent', { type: 'intent' }, 'intent'],
    ['reserved', { type: 'intent' }, 'reserved'],

    [null, { type: 'begin' }, 'reserved'],
    ['intent', { type: 'begin' }, 'reserved'],
    ['intent', { type: 'begin', edited: true }, 'reserved'],
    ['canceled', { type: 'begin' }, 'reserved'],
    ['abandoned', { type: 'begin' }, 'reserved'],
    ['failed', { type: 'begin' }, 'reserved'],
    ['reserved', { type: 'begin' }, 'reserved'],
    ['uploading', { type: 'begin' }, 'uploading'],
    ['processing', { type: 'begin' }, 'processing'],
    ['reserved', { type: 'begin', renew: true }, 'reserved'],
    ['uploading', { type: 'begin', renew: true }, 'reserved'],
    ['uploading', { type: 'begin', edited: true }, 'reserved'],
    ['processing', { type: 'begin', renew: true }, 'processing'],
    ['processing', { type: 'begin', edited: true }, null],
    ['delivered', { type: 'begin' }, 'delivered'],
    ['kept', { type: 'begin', edited: true }, 'kept'],

    ['reserved', { type: 'authorize' }, 'uploading'],
    ['uploading', { type: 'authorize' }, 'uploading'],
    ['intent', { type: 'authorize' }, null],
    ['canceled', { type: 'authorize' }, null],
    ['abandoned', { type: 'authorize' }, null],
    ['delivered', { type: 'authorize' }, null],

    ['uploading', { type: 'complete' }, 'processing'],
    ['reserved', { type: 'complete' }, 'processing'],
    ['processing', { type: 'complete' }, 'processing'],
    ['canceled', { type: 'complete' }, null],

    ['processing', { type: 'deliver', outcome: 'done' }, 'delivered'],
    ['uploading', { type: 'deliver', outcome: 'done' }, 'delivered'],
    ['processing', { type: 'deliver', outcome: 'kept' }, 'kept'],
    ['delivered', { type: 'deliver', outcome: 'done' }, 'delivered'],
    ['kept', { type: 'deliver', outcome: 'kept' }, 'kept'],
    ['abandoned', { type: 'deliver', outcome: 'done' }, 'delivered'],
    ['canceled', { type: 'deliver', outcome: 'done' }, 'delivered'],
    ['delivered', { type: 'deliver', outcome: 'kept' }, null],
    ['intent', { type: 'deliver', outcome: 'done' }, null],

    ['intent', { type: 'cancel', reason: 'canceled' }, 'canceled'],
    ['reserved', { type: 'cancel', reason: 'canceled' }, 'canceled'],
    ['uploading', { type: 'cancel', reason: 'edited' }, 'canceled'],
    ['intent', { type: 'cancel', reason: 'deleted' }, 'abandoned'],
    ['reserved', { type: 'cancel', reason: 'deleted' }, 'abandoned'],
    ['canceled', { type: 'cancel', reason: 'deleted' }, 'abandoned'],
    ['processing', { type: 'cancel', reason: 'canceled' }, 'processing'],
    ['delivered', { type: 'cancel', reason: 'deleted' }, 'delivered'],
    ['kept', { type: 'cancel', reason: 'canceled' }, 'kept'],

    ['reserved', { type: 'artifactAbandoned' }, 'abandoned'],
    ['uploading', { type: 'artifactAbandoned' }, 'abandoned'],
    ['processing', { type: 'artifactAbandoned' }, null],
    ['intent', { type: 'artifactAbandoned' }, null],
    ['delivered', { type: 'artifactAbandoned' }, null],

    ['kept', { type: 'retarget' }, 'delivered'],
    ['failed', { type: 'retarget' }, null],
    ['delivered', { type: 'retarget' }, null],

    [null, { type: 'refused' }, 'failed'],
    ['reserved', { type: 'refused' }, null],

    ['reserved', { type: 'nope' }, null],
  ];

  it.each(TABLE)('%s --%o--> %s', (from, event, to) => {
    expect(nextState(from === null ? null : { state: from }, event)).toBe(to);
  });

  it('has no event that abandons a row for time passing (O14)', () => {
    for (const state of PULSE_UPLOAD_STATES) {
      for (const type of ['sweep', 'overdue', 'expire', 'timeout']) {
        expect(nextState({ state }, { type })).toBeNull();
      }
    }
  });
});

describe('beginDecision', () => {
  it('inserts a row for a draft with none, and checks the place first', () => {
    const args = begin();
    expect(beginDecision([], args)).toMatchObject({
      action: 'insert',
      row: null,
      state: 'reserved',
      mintArtifact: true,
      retireArtifactId: null,
      resolveTarget: true,
      resolveSendContext: true,
      sentAt: args.sentAt,
      deliverAs: 'ticket.video',
      fallback: null,
      cancel: [],
    });
  });

  it('reuses the artifact for a retry with the same clientKey', () => {
    for (const state of ['reserved', 'uploading', 'processing']) {
      const existing = row({ state });
      expect(beginDecision([existing], begin()), state).toMatchObject({
        action: 'reuse',
        row: existing,
        state,
        mintArtifact: false,
        retireArtifactId: null,
        resolveTarget: false,
        resolveSendContext: false,
      });
    }
  });

  it('renews a gone artifact, unless its bytes are already in', () => {
    const uploading = row({ state: 'uploading' });
    expect(beginDecision([uploading], begin({ artifactGone: true }))).toMatchObject({
      action: 'renew',
      state: 'reserved',
      mintArtifact: true,
      retireArtifactId: uploading.artifactId,
    });
    expect(beginDecision([row({ state: 'processing' })], begin({ renewArtifact: true }))).toMatchObject({
      action: 'reuse',
      mintArtifact: false,
    });
  });

  it('reissues a cancelled, abandoned or refused row with the same clientKey', () => {
    for (const state of ['canceled', 'abandoned', 'failed']) {
      const existing = row({ state });
      expect(beginDecision([existing], begin()), state).toMatchObject({
        action: 'reissue',
        row: existing,
        state: 'reserved',
        mintArtifact: true,
        retireArtifactId: existing.artifactId,
        resolveTarget: state === 'failed',
        sentAt: existing.sentAt,
      });
    }
  });

  it("reissues the draft's row after an Edit: the new clientKey replaces the old artifact", () => {
    const existing = row({ state: 'uploading' });
    const args = begin({ clientKey: KEY_B });
    expect(beginDecision([existing], args)).toMatchObject({
      action: 'reissue',
      row: existing,
      state: 'reserved',
      mintArtifact: true,
      retireArtifactId: existing.artifactId,
      resolveTarget: false,
      resolveSendContext: true,
      sentAt: args.sentAt,
      cancel: [],
    });
  });

  it('checks the new place on a Move to…', () => {
    const existing = row({ state: 'failed' });
    const args = begin({ clientKey: KEY_B, target: { kind: 'ticket', id: OTHER_TICKET } });
    expect(beginDecision([existing], args)).toMatchObject({
      action: 'reissue',
      resolveTarget: true,
      deliverAs: 'ticket.video',
    });
  });

  it('adopts the clock intent by draftKey after an Edit gave the Send a new clientKey', () => {
    // The clock call recorded KEY_A's Send; the person then edited, so the
    // begin carries KEY_B. Still this draft's video: the intent takes it.
    const intent = wrapupIntent({ clientKey: KEY_A, sentAt: new Date(NOW - 2 * HOUR) });
    const decision = beginDecision([intent], wrapupBegin({ clientKey: KEY_B }));
    expect(decision).toMatchObject({
      action: 'adoptIntent',
      row: intent,
      state: 'reserved',
      mintArtifact: true,
      retireArtifactId: null,
      resolveTarget: false,
      resolveSendContext: false,
      sentAt: intent.sentAt, // the clock action's time, not the later Send's (O13)
      deliverAs: 'clock.wrapup',
      fallback: null,
    });
  });

  it('adopts an intent the clock call made without a clientKey', () => {
    const intent = wrapupIntent();
    expect(beginDecision([intent], wrapupBegin())).toMatchObject({ action: 'adoptIntent', state: 'reserved' });
  });

  it('adopts an intent with the same clientKey, never reusing its missing artifact', () => {
    const intent = wrapupIntent({ clientKey: KEY_A });
    expect(beginDecision([intent], wrapupBegin())).toMatchObject({ action: 'adoptIntent', mintArtifact: true });
  });

  it('starts an abandoned clock row again: a late video still attaches (O14)', () => {
    const abandoned = wrapupIntent({ state: 'abandoned', clientKey: KEY_A, artifactId: 'old' });
    expect(beginDecision([abandoned], wrapupBegin({ clientKey: KEY_B }))).toMatchObject({
      action: 'reissue',
      state: 'reserved',
      retireArtifactId: 'old',
      resolveTarget: false,
      sentAt: abandoned.sentAt,
    });
  });

  it('never moves a clock video whose clock action ran (O13)', () => {
    const intent = wrapupIntent();
    const moved = begin({ clientKey: KEY_B, type: 'ticket.video', target: { kind: 'ticket', id: TICKET } });
    expect(beginDecision([intent], moved)).toMatchObject({ action: 'conflict', error: 'conflict' });
    const reserved = wrapupIntent({ state: 'reserved', clientKey: KEY_A, artifactId: 'a1' });
    expect(beginDecision([reserved], moved)).toMatchObject({ action: 'conflict', error: 'conflict' });
  });

  it('delivers a clock type with no intent as its fallback, flagged', () => {
    expect(beginDecision([], wrapupBegin())).toMatchObject({
      action: 'insert',
      deliverAs: 'clock.session',
      fallback: 'no-clock-action',
      resolveTarget: true,
    });
    const plan = begin({ type: 'clock.plan', target: { kind: 'clock-plan', teamId: TEAM, postDate: '2026-11-18' } });
    expect(beginDecision([], plan)).toMatchObject({ deliverAs: 'library.video', fallback: 'no-clock-action' });
  });

  it("lets a fallback clock row move, since no clock action ran", () => {
    const fallback = wrapupIntent({ state: 'failed', clientKey: KEY_A, fallback: 'no-clock-action' });
    const moved = begin({ clientKey: KEY_B, type: 'library.video', target: { kind: 'library' } });
    expect(beginDecision([fallback], moved)).toMatchObject({
      action: 'reissue',
      resolveTarget: true,
      deliverAs: 'library.video',
      fallback: null,
    });
  });

  it('refuses a clientKey already used for another type or place', () => {
    const existing = row({ state: 'reserved' });
    const other = begin({ target: { kind: 'ticket', id: OTHER_TICKET } });
    expect(beginDecision([existing], other)).toMatchObject({ action: 'conflict', error: 'conflict' });
  });

  it('refuses an Edit once the bytes are in', () => {
    expect(beginDecision([row({ state: 'processing' })], begin({ clientKey: KEY_B }))).toMatchObject({
      action: 'conflict',
      error: 'conflict',
    });
  });

  it('returns the outcome of a video that already landed', () => {
    for (const state of ['delivered', 'kept']) {
      const done = row({ state });
      expect(beginDecision([done], begin()), state).toMatchObject({
        action: 'returnOutcome',
        row: done,
        state,
        mintArtifact: false,
      });
      expect(beginDecision([done], begin({ clientKey: KEY_B })).action, state).toBe('returnOutcome');
    }
  });

  it('cancels older attempts of the draft still under way, but never an intent', () => {
    const older = row({ clientKey: `${DRAFT}:1111111111111111`, state: 'uploading', updatedAt: new Date(NOW - 3 * HOUR) });
    const current = row({ state: 'canceled' });
    const intent = wrapupIntent({ state: 'intent', updatedAt: new Date(NOW - 4 * HOUR) });
    const decision = beginDecision([older, current, intent], begin());
    expect(decision.action).toBe('reissue');
    expect(decision.cancel).toEqual([{ _id: older._id, reason: 'edited' }]);
  });

  it('refuses a too-large video before anything else, row or not', () => {
    const tooLarge = begin({ bytes: PULSE_MAX_UPLOAD_BYTES + 1 });
    for (const rows of [[], [row({ state: 'reserved' })], [row({ state: 'delivered' })]]) {
      expect(beginDecision(rows, tooLarge)).toEqual({
        action: 'refuse',
        error: 'too-large',
        reason: 'Too large to send to TimeHuddle (max 500 MB)',
      });
    }
    expect(beginDecision([wrapupIntent()], wrapupBegin({ bytes: 600 * 1024 * 1024 })).error).toBe('too-large');
  });
});

describe('intentDecision', () => {
  const wrapup = { type: 'clock.wrapup', targetKey: `clock:${SESSION}`, bytes: 1000 };

  it('inserts an intent for a draft with no row', () => {
    expect(intentDecision([], wrapup)).toEqual({ action: 'insert', state: 'intent' });
  });

  it('repeats the first answer for a draft whose clock call already ran', () => {
    const intent = wrapupIntent();
    expect(intentDecision([intent], wrapup)).toEqual({ action: 'repeat', row: intent });
    const adopted = wrapupIntent({ state: 'reserved', clientKey: KEY_A });
    expect(intentDecision([adopted], wrapup)).toEqual({ action: 'repeat', row: adopted });
  });

  it('refuses a draft already sent elsewhere, and a too-large video before any clock action', () => {
    expect(intentDecision([row()], wrapup)).toMatchObject({ action: 'conflict', error: 'conflict' });
    expect(intentDecision([], { ...wrapup, bytes: PULSE_MAX_UPLOAD_BYTES + 1 })).toMatchObject({ error: 'too-large' });
  });
});

describe('hookDecision', () => {
  const VIDEO = 'video-1';
  const reserved = () => row({ artifactId: VIDEO, state: 'reserved' });
  const authorize = (artifactId: string, phase = 'create') => ({ type: 'authorize', phase, artifactId });

  // [what, row state, event, isVideo, expected]
  const TABLE: Array<[string, string, Record<string, unknown>, boolean, Record<string, unknown>]> = [
    ['captions created first leave the row reserved', 'reserved', authorize('captions-1'), false, { action: 'none' }],
    ['captions completing leave it reserved', 'reserved', { type: 'complete', artifactId: 'captions-1' }, false, { action: 'none' }],
    ['the manifest', 'reserved', authorize('manifest-1'), false, { action: 'none' }],
    ['the thumbnail completing', 'reserved', { type: 'complete', artifactId: 'thumb-1' }, false, { action: 'none' }],
    ['captions while the video uploads', 'uploading', authorize('captions-1'), false, { action: 'none' }],
    ['the video created', 'reserved', authorize(VIDEO), true, { action: 'move', state: 'uploading' }],
    ['the video created again', 'uploading', authorize(VIDEO), true, { action: 'none' }],
    ['the video patched', 'uploading', authorize(VIDEO, 'patch'), true, { action: 'none' }],
    ['the video complete', 'uploading', { type: 'complete', artifactId: VIDEO }, true, { action: 'move', state: 'processing' }],
    ['the video complete, replayed', 'processing', { type: 'complete', artifactId: VIDEO }, true, { action: 'none' }],
    ['the video delivered', 'processing', { type: 'uploadComplete', artifactId: VIDEO }, true, { action: 'deliver' }],
    ['the video abandoned', 'uploading', { type: 'remove', reason: 'abandoned', artifactId: VIDEO }, true, { action: 'move', state: 'abandoned' }],
    ['the video deleted otherwise', 'uploading', { type: 'remove', reason: 'deleted', artifactId: VIDEO }, true, { action: 'none' }],
    ['captions abandoned', 'uploading', { type: 'remove', reason: 'abandoned', artifactId: 'captions-1' }, false, { action: 'none' }],
    ['a processing video removed', 'processing', { type: 'remove', reason: 'abandoned', artifactId: VIDEO }, true, { action: 'none' }],
    ['captions on a cancelled row', 'canceled', authorize('captions-1'), false, { action: 'refuse' }],
    ['the video on a cancelled row', 'canceled', authorize(VIDEO), true, { action: 'refuse' }],
    ['a patch on an abandoned row', 'abandoned', authorize(VIDEO, 'patch'), true, { action: 'refuse' }],
    ['another video under this token', 'reserved', authorize('video-2'), true, { action: 'refuse' }],
  ];

  it.each(TABLE)('%s', (_what, state, event, isVideo, expected) => {
    expect(hookDecision({ ...reserved(), state }, event, isVideo)).toEqual(expected);
  });

  it('refuses an older artifact of the row, video or not', () => {
    const renewed = row({ artifactId: 'video-2', replacedArtifactIds: ['video-1', 'captions-1'], state: 'reserved' });
    expect(hookDecision(renewed, authorize('video-1'), true)).toEqual({ action: 'refuse' });
    expect(hookDecision(renewed, authorize('captions-1'), false)).toEqual({ action: 'refuse' });
    expect(hookDecision(renewed, { type: 'complete', artifactId: 'video-1' }, true)).toEqual({ action: 'none' });
  });

  it('never replaces the artifactId, whatever the event', () => {
    const events = TABLE.map(([, , event, isVideo]) => [event, isVideo] as const);
    for (const state of PULSE_UPLOAD_STATES) {
      for (const [event, isVideo] of events) {
        const decision = hookDecision({ ...reserved(), state }, event, isVideo);
        expect(Object.keys(decision).every((key) => key === 'action' || key === 'state')).toBe(true);
      }
    }
  });

  it('leaves a link-flow upload (no row) alone', () => {
    expect(hookDecision(null, authorize(VIDEO), true)).toEqual({ action: 'none' });
  });
});

describe('the overdue sweep', () => {
  const at = (ms: number) => new Date(ms);

  it('selects rows whose video has not landed 24 h after Send', () => {
    const due = row({ state: 'reserved', sentAt: at(NOW - PULSE_OVERDUE_AFTER_MS) });
    const intent = wrapupIntent({ sentAt: at(NOW - 2 * DAY) });
    const uploading = row({ state: 'uploading', sentAt: at(NOW - 25 * HOUR) });
    const young = row({ state: 'reserved', sentAt: at(NOW - PULSE_OVERDUE_AFTER_MS + 1) });
    const flagged = row({ state: 'reserved', sentAt: at(NOW - 3 * DAY), overdueAt: at(NOW - DAY) });
    expect(selectOverdue([due, intent, uploading, young, flagged], NOW)).toEqual([due, intent, uploading]);
  });

  it('falls back to createdAt without a sentAt', () => {
    expect(isOverdue(row({ sentAt: null, createdAt: at(NOW - 2 * DAY) }), NOW)).toBe(true);
    expect(isOverdue(row({ sentAt: null, createdAt: null }), NOW)).toBe(false);
  });

  it('never selects a row whose video landed or that was given up', () => {
    const old = at(NOW - 30 * DAY);
    for (const state of ['processing', 'delivered', 'kept', 'canceled', 'failed', 'abandoned']) {
      expect(selectOverdue([row({ state, sentAt: old, createdAt: old })], NOW), state).toEqual([]);
    }
  });

  it('leaves the rows it selects in their state: overdue is a flag, not abandoned', () => {
    const rows = PULSE_UPLOAD_STATES.map((state) => row({ state, sentAt: at(NOW - 3 * DAY) }));
    const before = rows.map((r) => r.state);
    const selected = selectOverdue(rows, NOW);
    expect(selected.map((r) => r.state)).toEqual(['intent', 'reserved', 'uploading']);
    expect(rows.map((r) => r.state)).toEqual(before);
    expect(selected.every((r) => r.state !== 'abandoned' && r.overdueAt === undefined)).toBe(true);
  });

  it('queries the same rows', () => {
    const cutoff = at(NOW - PULSE_OVERDUE_AFTER_MS);
    expect(overdueQuery(NOW)).toEqual({
      state: { $in: ['intent', 'reserved', 'uploading'] },
      overdueAt: null,
      $or: [{ sentAt: { $lte: cutoff } }, { sentAt: null, createdAt: { $lte: cutoff } }],
    });
  });
});

describe('serverErrorToPulseCode', () => {
  it.each([
    [{ error: 'not-found' }, 'destination.gone'],
    [{ error: 'forbidden' }, 'destination.gone'],
    [{ error: 'bad-request' }, 'upload.refused'],
    [{ error: 'conflict' }, 'upload.refused'],
    [{ error: 'too-large' }, 'upload.too_large'],
    [{ error: 'not-authorized' }, 'no_account'],
    [{ status: 401 }, 'no_account'],
    [{ error: 'too-many-requests' }, 'host.unavailable'],
    [{ status: 429, error: 'bad-request' }, 'host.unavailable'],
    [{ status: 502 }, 'host.unavailable'],
    [{ status: 404, error: 'not-found' }, 'destination.gone'],
    [{ error: 'constructor' }, 'host.unavailable'],
    [{ error: 'something-new' }, 'host.unavailable'],
    [null, 'host.unavailable'],
  ])('%o → %s', (failure, code) => {
    expect(serverErrorToPulseCode(failure)).toBe(code);
  });
});
