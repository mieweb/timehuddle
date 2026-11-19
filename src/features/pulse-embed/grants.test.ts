import { createFakePulse } from '@mieweb/pulse-embed/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clockApi, pulseUploadApi, type PulseUploadTypeInfo } from '../../lib/api';
import type { ConfirmSendRequest, PulseContext, UploadTargetRequest } from './client';
import { CONFIRM_SEND_TIMEOUT_MS, createGrants, HostServiceFailure, pulseCodeOf } from './grants';
import { pulsePlace, type PulsePlaceInput, uploadTypeSpecOf } from './place';

vi.mock('../../lib/api', () => {
  /** wormholeCall's failure: the HTTP status, and the Meteor error code when the server sent one. */
  class ApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly code?: string,
    ) {
      super(message);
    }
  }
  return {
    ApiError,
    pulseUploadApi: { begin: vi.fn(), token: vi.fn(), cancel: vi.fn() },
    clockApi: { stopWithVideo: vi.fn(), startWithPlan: vi.fn() },
  };
});

const api = await import('../../lib/api');
const ApiError = api.ApiError as unknown as new (m: string, s: number, c?: string) => Error;
const begin = vi.mocked(pulseUploadApi.begin);
const token = vi.mocked(pulseUploadApi.token);
const cancel = vi.mocked(pulseUploadApi.cancel);
const stopWithVideo = vi.mocked(clockApi.stopWithVideo);
const startWithPlan = vi.mocked(clockApi.startWithPlan);

const TICKET = '64b1f0c2a9e8d7c6b5a49382';
const SESSION = '65aa00b1c2d3e4f5a6b7c8d9';
const TEAM = 'Tm7xKq2ZpR4sW9aBc';
const SENT_AT = 1_763_400_000_000;
const DRAFT_KEY = 'inst-1:d-1';
const CLIENT_KEY = 'inst-1:d-1:0123456789abcdef';

function typeInfo(id: PulseUploadTypeInfo['id']): PulseUploadTypeInfo {
  const clock = id === 'clock.wrapup' ? 'stop' : id === 'clock.plan' ? 'start' : null;
  return {
    id,
    version: 1,
    targetKind: 'ticket',
    title: null,
    sendLabel: null,
    prompt: null,
    limits: null,
    requireName: false,
    clock,
    requireOnline: clock != null,
    confirmSend: clock != null,
    maxBytes: 524_288_000,
  };
}

function contextOf(input: PulsePlaceInput): PulseContext {
  const place = pulsePlace({ ...input, uploadType: typeInfo(input.type) });
  if (!place) throw new Error(`no place for ${input.type}`);
  return place.context;
}

const ticketContext = () =>
  contextOf({ type: 'ticket.video', ticketId: TICKET, label: 'Fix login' });
const wrapUpContext = () =>
  contextOf({
    type: 'clock.wrapup',
    clockEventId: SESSION,
    teamId: TEAM,
    postDate: '2026-11-18',
    label: 'Platform',
  });
const planContext = () =>
  contextOf({ type: 'clock.plan', teamId: TEAM, postDate: '2026-11-18', label: 'Platform' });

function targetRequest(over: Partial<UploadTargetRequest> = {}): UploadTargetRequest {
  return {
    draftId: 'd-1',
    clientKey: CLIENT_KEY,
    draftKey: DRAFT_KEY,
    context: ticketContext(),
    name: 'Login bug',
    durationMs: 42_000,
    bytes: 1_000_000,
    sentAt: SENT_AT,
    attempt: 1,
    renewArtifact: false,
    ...over,
  };
}

function confirmRequest(context: PulseContext): ConfirmSendRequest {
  return {
    draftId: 'd-1',
    draftKey: DRAFT_KEY,
    context,
    uploadType: context.uploadType!,
    sentAt: SENT_AT,
    bytes: 1_000_000,
  };
}

const GRANT = {
  uploadId: 'up-1',
  clientKey: CLIENT_KEY,
  artifactId: 'art-1',
  endpoint: 'https://huddle.example.org/pulsevault/',
  token: 'tok',
  expiresAt: SENT_AT + 7_200_000,
  state: 'reserved' as const,
  label: 'Fix login',
};

const CLOCK_SEND = {
  uploadId: 'up-9',
  postId: 'post-1',
  clockEvent: {
    id: SESSION,
    userId: 'u1',
    teamId: TEAM,
    startTime: 0,
    accumulatedTime: 0,
    endTime: SENT_AT,
  },
};

/** What a call rejected with, as Pulse reads it. */
async function rejection(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    const { code, message } = e as { code?: unknown; message?: unknown };
    return { code, message };
  }
  throw new Error('expected a rejection');
}

beforeEach(() => {
  for (const fn of [begin, token, cancel, stopWithVideo, startWithPlan]) fn.mockReset();
});

describe('pulseCodeOf', () => {
  it.each<[string, unknown, string]>([
    ['not-found', new ApiError('Ticket not found', 400, 'not-found'), 'destination.gone'],
    ['forbidden', new ApiError('Not yours', 403, 'forbidden'), 'destination.gone'],
    ['bad-request', new ApiError('Invalid target', 400, 'bad-request'), 'upload.refused'],
    ['conflict', new ApiError('Already sent', 409, 'conflict'), 'upload.refused'],
    ['too-large', new ApiError('Too large', 400, 'too-large'), 'upload.too_large'],
    ['HTTP 401', new ApiError('Unauthorized', 401), 'no_account'],
    ['401 with a code', new ApiError('Signed out', 401, 'not-found'), 'no_account'],
    ['not-authorized', new ApiError('Sign in', 400, 'not-authorized'), 'no_account'],
    ['too-many-requests', new ApiError('Slow down', 400, 'too-many-requests'), 'host.unavailable'],
    ['HTTP 429', new ApiError('Slow down', 429), 'host.unavailable'],
    ['HTTP 500', new ApiError('Boom', 500), 'host.unavailable'],
    ['a 5xx with a code', new ApiError('Bad gateway', 502, 'not-found'), 'host.unavailable'],
    ['a bare 404', new ApiError('Not found', 404), 'destination.gone'],
    ['a bare 413', new ApiError('Too large', 413), 'upload.too_large'],
    ['an unknown status', new ApiError("I'm a teapot", 418), 'host.unavailable'],
    ['a network failure', new TypeError('Load failed'), 'host.unavailable'],
    ['a stalled call', new Error('Timed out'), 'host.unavailable'],
    ['anything else', 'nope', 'host.unavailable'],
  ])('maps %s', (_name, error, code) => {
    expect(pulseCodeOf(error)).toBe(code);
  });

  it('keeps a code grants already chose', () => {
    expect(pulseCodeOf(new HostServiceFailure('destination.gone', 'x'))).toBe('destination.gone');
  });
});

describe('getUploadTarget', () => {
  it("begins the upload for the draft's type and target, and answers what Pulse needs", async () => {
    begin.mockResolvedValue(GRANT);
    const grants = createGrants({
      clientInfo: () => ({ appVersion: '2.8.0', contractVersion: '1.1', platform: 'ios' }),
    });
    const target = await grants.getUploadTarget(targetRequest());
    expect(begin).toHaveBeenCalledWith({
      clientKey: CLIENT_KEY,
      draftKey: DRAFT_KEY,
      type: 'ticket.video',
      target: { kind: 'ticket', id: TICKET },
      name: 'Login bug',
      sentAt: SENT_AT,
      durationMs: 42_000,
      bytes: 1_000_000,
      client: { appVersion: '2.8.0', contractVersion: '1.1', platform: 'ios' },
    });
    expect(target).toEqual({
      uploadId: 'up-1',
      endpoint: 'https://huddle.example.org/pulsevault',
      artifactId: 'art-1',
      token: 'tok',
      expiresAt: SENT_AT + 7_200_000,
      clientKey: CLIENT_KEY,
      state: 'reserved',
    });
  });

  it('asks for a new artifact when PulseVault lost the old one', async () => {
    begin.mockResolvedValue(GRANT);
    await createGrants().getUploadTarget(targetRequest({ renewArtifact: true, attempt: 2 }));
    expect(begin.mock.calls[0][0]).toMatchObject({ renewArtifact: true });
  });

  it('refuses a draft with no TimeHuddle place as gone, without asking the server', async () => {
    const context = { key: 'ticket:42', kind: 'ticket', id: '42', label: 'Fix login' };
    expect(
      await rejection(createGrants().getUploadTarget(targetRequest({ context }))),
    ).toMatchObject({ code: 'destination.gone' });
    expect(begin).not.toHaveBeenCalled();
  });

  it("tells Pulse the server's refusal", async () => {
    begin.mockRejectedValue(new ApiError('Ticket not found', 400, 'not-found'));
    expect(await rejection(createGrants().getUploadTarget(targetRequest()))).toEqual({
      code: 'destination.gone',
      message: 'Ticket not found',
    });
  });
});

describe('refreshUploadToken and releaseUploadTarget', () => {
  it("re-mints the upload's token", async () => {
    token.mockResolvedValue({ token: 'tok-2', expiresAt: 5 });
    const grants = createGrants();
    expect(
      await grants.refreshUploadToken({ uploadId: 'up-1', clientKey: CLIENT_KEY, draftId: 'd-1' }),
    ).toEqual({ token: 'tok-2', expiresAt: 5 });
    expect(token).toHaveBeenCalledWith('up-1', CLIENT_KEY);
  });

  it('cancels the upload with the reason', async () => {
    cancel.mockResolvedValue({ state: 'canceled' });
    await createGrants().releaseUploadTarget!({
      uploadId: 'up-1',
      clientKey: CLIENT_KEY,
      reason: 'edited',
    });
    expect(cancel).toHaveBeenCalledWith({
      uploadId: 'up-1',
      clientKey: CLIENT_KEY,
      reason: 'edited',
    });
  });

  it('reports a signed-out token call as no account', async () => {
    token.mockRejectedValue(new ApiError('Unauthorized', 401));
    expect(
      await rejection(
        createGrants().refreshUploadToken({
          uploadId: 'up-1',
          clientKey: CLIENT_KEY,
          draftId: 'd',
        }),
      ),
    ).toMatchObject({ code: 'no_account' });
  });
});

describe('confirmSend', () => {
  afterEach(() => vi.useRealTimers());

  it('clocks out at Send for a wrap-up, and says when', async () => {
    stopWithVideo.mockResolvedValue(CLOCK_SEND);
    const onClockSend = vi.fn();
    const grants = createGrants({ now: () => SENT_AT + 900, onClockSend });
    expect(await grants.confirmSend!(confirmRequest(wrapUpContext()))).toEqual({
      confirmedAt: SENT_AT + 900,
    });
    expect(stopWithVideo).toHaveBeenCalledWith({
      teamId: TEAM,
      clockEventId: SESSION,
      postDate: '2026-11-18',
      at: SENT_AT,
      draftKey: DRAFT_KEY,
      bytes: 1_000_000,
    });
    expect(startWithPlan).not.toHaveBeenCalled();
    expect(onClockSend).toHaveBeenCalledWith({
      ...CLOCK_SEND,
      type: 'clock.wrapup',
      draftId: 'd-1',
      draftKey: DRAFT_KEY,
    });
  });

  it("clocks in at Send for a plan, on the plan's day", async () => {
    startWithPlan.mockResolvedValue({ ...CLOCK_SEND, conversationId: 'c1' });
    await createGrants().confirmSend!(confirmRequest(planContext()));
    expect(startWithPlan).toHaveBeenCalledWith({
      teamId: TEAM,
      postDate: '2026-11-18',
      at: SENT_AT,
      draftKey: DRAFT_KEY,
      bytes: 1_000_000,
    });
    expect(stopWithVideo).not.toHaveBeenCalled();
  });

  it('refuses a type with no clock action, or a spec that is not the draft’s', async () => {
    const grants = createGrants();
    const ticket = confirmRequest({
      ...ticketContext(),
      uploadType: uploadTypeSpecOf(typeInfo('clock.wrapup')),
    });
    expect(await rejection(grants.confirmSend!(ticket))).toMatchObject({ code: 'upload.refused' });
    const session = contextOf({ type: 'clock.session', clockEventId: SESSION, label: 'Mon' });
    expect(await rejection(grants.confirmSend!(confirmRequest(session)))).toMatchObject({
      code: 'upload.refused',
    });
    expect(stopWithVideo).not.toHaveBeenCalled();
    expect(startWithPlan).not.toHaveBeenCalled();
  });

  it("passes on the server's refusal: a video too large changes nothing", async () => {
    stopWithVideo.mockRejectedValue(new ApiError('Too large to send', 400, 'too-large'));
    expect(await rejection(createGrants().confirmSend!(confirmRequest(wrapUpContext())))).toEqual({
      code: 'upload.too_large',
      message: 'Too large to send',
    });
  });

  it('gives up after 20 s, so Pulse can offer Try again', async () => {
    vi.useFakeTimers();
    stopWithVideo.mockReturnValue(new Promise(() => {}));
    let outcome: unknown = 'pending';
    createGrants().confirmSend!(confirmRequest(wrapUpContext())).then(
      () => (outcome = 'resolved'),
      (e: { code: string }) => (outcome = e.code),
    );
    await vi.advanceTimersByTimeAsync(CONFIRM_SEND_TIMEOUT_MS - 1);
    expect(outcome).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toBe('host.unavailable');
    expect(CONFIRM_SEND_TIMEOUT_MS).toBe(20_000);
  });
});

describe('through Pulse (the fake facade)', () => {
  it('a wrap-up Send clocks out before Pulse closes, then its upload asks the server', async () => {
    stopWithVideo.mockResolvedValue(CLOCK_SEND);
    begin.mockRejectedValue(new ApiError('Clock session not found', 400, 'not-found'));
    const fetch = vi.fn();
    const fake = createFakePulse({
      flows: [{ result: 'sent' }],
      server: { fixture: new ArrayBuffer(16), fetch },
    });
    try {
      const { client } = fake;
      await client.configure({ uploadMode: 'pulse' });
      client.setHostServices(createGrants());
      const result = await client.record(wrapUpContext());
      if (result.status !== 'completed' || result.mode !== 'pulse') {
        throw new Error(`expected a Send, got ${JSON.stringify(result)}`);
      }
      expect(result.confirmedAt).toEqual(expect.any(Number));
      expect(stopWithVideo).toHaveBeenCalledTimes(1);
      expect(stopWithVideo.mock.calls[0][0]).toMatchObject({
        clockEventId: SESSION,
        at: result.sentAt,
        draftKey: result.draftKey,
      });
      await vi.waitFor(() => expect(begin).toHaveBeenCalled());
      expect(begin.mock.calls[0][0]).toMatchObject({
        clientKey: result.clientKey,
        type: 'clock.wrapup',
        target: { kind: 'clock', id: SESSION },
      });
      // The server said the place is gone: the job fails for Move to… / Delete, no bytes sent.
      await vi.waitFor(async () => {
        const draft = await client.getDraft(result.draftId);
        expect(draft?.state).toBe('failed');
        expect(draft?.upload?.error?.code).toBe('destination.gone');
      });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fake.dispose();
    }
  });
});
