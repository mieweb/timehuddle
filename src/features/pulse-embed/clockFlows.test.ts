import type { DraftSummary, FlowResult, PulseClient, PulseInfo } from '@mieweb/pulse-embed';
import { act, cleanup, renderHook } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClockEvent, PulseTeamSettings, PulseUploadTypeInfo } from '../../lib/api';
import { formatTime } from '../../lib/timeUtils';
import {
  CLOCK_DRAFTS_FILTER,
  clockFlowAnnounced,
  clockFlowNotice,
  clockPulsePlace,
  clockUnsentCounts,
  noteClockSend,
  takeClockSend,
  useClockPulse,
  type UseClockPulseOptions,
} from './clockFlows';
import { CLOCK_PULSE_TEXT as T } from './clockPulseStrings';
import type { ClockSendOutcome } from './grants';
import { PRE_PROMPT_SEEN_KEY, resetPrePromptForTests } from './PermissionPrePrompt';
import { pulsePlace } from './place';
import { PULSE_EMBED_OFF, PulseEmbedContext, type PulseEmbed } from './usePulseEmbed';

const device = vi.hoisted(() => ({ native: true }));
vi.mock('../../lib/device', () => ({
  isNativeApp: () => device.native,
  isMobileBrowser: () => false,
}));

const toasts = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@mieweb/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@mieweb/ui')>()),
  useOptionalToast: () => toasts,
}));

// The clock calls this module must never make: the clock acts at Send, in grants.ts.
const clockCalls = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  stopWithVideo: vi.fn(),
  startWithPlan: vi.fn(),
}));
vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, clockApi: { ...actual.clockApi, ...clockCalls } };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TEAM = 'team1';
const SESSION_ID = 'evt1';
const POST_DATE = '2026-11-19';

const at = (hour: number, minute: number) => new Date(2026, 10, 19, hour, minute).getTime();
const shown = (ms: number) => formatTime(new Date(ms), 'en-US');

const INFO = {
  sdkVersion: '2.8.0',
  contract: { major: 1, minor: 0 },
  platform: 'ios',
  supported: true,
} as unknown as PulseInfo;

const settings = (pulseClockInOut: boolean): PulseTeamSettings => ({
  pulseInApp: true,
  pulseClockInOut,
  pulseSharedDevice: false,
});

const typeInfo = (id: 'clock.wrapup' | 'clock.plan'): PulseUploadTypeInfo => ({
  id,
  version: 1,
  targetKind: id === 'clock.plan' ? 'clock-plan' : 'clock',
  title: id === 'clock.plan' ? 'Plan' : 'Wrap-up',
  sendLabel: id === 'clock.plan' ? 'Clock in & send' : 'Clock out & send',
  prompt: null,
  limits: null,
  requireName: false,
  clock: id === 'clock.plan' ? 'start' : 'stop',
  requireOnline: true,
  confirmSend: true,
  maxBytes: 500 * 1024 * 1024,
});

const wrapUpPlace = pulsePlace({
  type: 'clock.wrapup',
  clockEventId: SESSION_ID,
  teamId: TEAM,
  postDate: POST_DATE,
  label: 'Platform',
  uploadType: typeInfo('clock.wrapup'),
})!;
const planPlace = pulsePlace({
  type: 'clock.plan',
  teamId: TEAM,
  postDate: POST_DATE,
  label: 'Platform',
  uploadType: typeInfo('clock.plan'),
})!;

const base = (context = wrapUpPlace.context) => ({
  requestId: 'r1',
  entry: 'record' as const,
  endedOn: 'export' as const,
  stage: 'exported' as const,
  context,
  endedAt: 2,
});

function sent(
  draftId: string,
  over: { sentAt?: number; confirmedAt?: number | null; context?: typeof wrapUpPlace.context } = {},
): FlowResult {
  return {
    ...base(over.context),
    status: 'completed',
    mode: 'pulse',
    draftId,
    sentAt: over.sentAt ?? at(17, 2),
    clientKey: `inst:${draftId}:0123456789abcdef`,
    draftKey: `inst:${draftId}`,
    ...(over.confirmedAt === null ? {} : { confirmedAt: over.confirmedAt ?? at(17, 2) }),
  } as FlowResult;
}

const kept = (context = wrapUpPlace.context): FlowResult =>
  ({ ...base(context), status: 'closed', reason: 'user', draftId: 'd-kept' }) as FlowResult;

function clockEvent(over: Partial<ClockEvent>): ClockEvent {
  return {
    id: SESSION_ID,
    userId: 'u1',
    teamId: TEAM,
    startTime: at(9, 0),
    accumulatedTime: 0,
    endTime: null,
    ...over,
  };
}

function outcome(
  draftId: string,
  type: ClockSendOutcome['type'],
  event: Partial<ClockEvent>,
): ClockSendOutcome {
  return {
    type,
    draftId,
    draftKey: `inst:${draftId}`,
    uploadId: `up-${draftId}`,
    postId: 'post1',
    clockEvent: clockEvent(event),
  };
}

// ─── The place ────────────────────────────────────────────────────────────────

describe('clockPulsePlace', () => {
  it("records the open session's wrap-up, keyed with the session's own videos", () => {
    const place = clockPulsePlace({
      session: { id: SESSION_ID, teamId: TEAM },
      teamId: 'other-team',
      teamName: 'Platform',
      postDate: POST_DATE,
    });
    expect(place).toEqual({
      type: 'clock.wrapup',
      clockEventId: SESSION_ID,
      teamId: TEAM,
      postDate: POST_DATE,
      label: 'Platform',
    });
    const built = pulsePlace(place!)!;
    expect(built.context.key).toBe(`clock:${SESSION_ID}`);
    expect(built.type).toBe('clock.wrapup');
  });

  it("records today's plan for the team when clocked out", () => {
    const place = clockPulsePlace({
      session: null,
      teamId: TEAM,
      teamName: 'Platform',
      postDate: POST_DATE,
    });
    expect(place).toEqual({
      type: 'clock.plan',
      teamId: TEAM,
      postDate: POST_DATE,
      label: 'Platform',
    });
    expect(pulsePlace(place!)!.context.key).toBe(`clock-plan:${TEAM}:${POST_DATE}`);
  });

  it('has nothing to record without a session or a team', () => {
    expect(
      clockPulsePlace({ session: null, teamId: null, teamName: null, postDate: POST_DATE }),
    ).toBeNull();
  });
});

// ─── What the page says ───────────────────────────────────────────────────────

describe('clockFlowNotice', () => {
  it("says the clock-out time the server recorded, not Pulse's sentAt", () => {
    const result = sent('d1', { sentAt: at(17, 1) });
    const notice = clockFlowNotice(
      'clock.wrapup',
      result,
      outcome('d1', 'clock.wrapup', { endTime: at(17, 2) }),
    );
    expect(notice).toEqual({ message: T.clockedOut(shown(at(17, 2))), clockOutNow: false });
    expect(notice?.message).not.toContain(shown(at(17, 1)));
  });

  it('says the time the server recorded when it replaced a Send more than 30 minutes old', () => {
    // Sent at 16:20 (offline, say), confirmed at 17:02: the server's clientTimeOrNow
    // recorded its own now, and the toast says so.
    const result = sent('d1', { sentAt: at(16, 20), confirmedAt: at(17, 2) });
    const notice = clockFlowNotice(
      'clock.wrapup',
      result,
      outcome('d1', 'clock.wrapup', { endTime: at(17, 2) }),
    );
    expect(notice?.message).toBe(`Clocked out at ${shown(at(17, 2))} · video sending`);
    expect(notice?.message).not.toContain(shown(at(16, 20)));
  });

  it('says the clock-in time of the session the server started', () => {
    const notice = clockFlowNotice(
      'clock.plan',
      sent('d2', { sentAt: at(8, 15), context: planPlace.context }),
      outcome('d2', 'clock.plan', { startTime: at(9, 2) }),
    );
    expect(notice).toEqual({ message: T.clockedIn(shown(at(9, 2))), clockOutNow: false });
  });

  it('gives no time, rather than sentAt, when the clock answer was not noted', () => {
    const notice = clockFlowNotice('clock.wrapup', sent('d1', { sentAt: at(17, 1) }), null);
    expect(notice).toEqual({ message: 'Clocked out · video sending', clockOutNow: false });
  });

  it('ignores an answer for the other clock type', () => {
    const notice = clockFlowNotice(
      'clock.wrapup',
      sent('d1'),
      outcome('d1', 'clock.plan', { startTime: at(9, 2) }),
    );
    expect(notice?.message).toBe(T.clockedOut(null));
  });

  it('says still clocked in, with Clock out now, after a kept wrap-up', () => {
    expect(clockFlowNotice('clock.wrapup', kept(), null)).toEqual({
      message: 'Still clocked in',
      clockOutNow: true,
    });
  });

  it('says still clocked out after a kept plan, with no action', () => {
    expect(clockFlowNotice('clock.plan', kept(planPlace.context), null)).toEqual({
      message: T.stillClockedOut,
      clockOutNow: false,
    });
  });

  it('treats a Send that was never confirmed as nothing clocked', () => {
    expect(clockFlowNotice('clock.wrapup', sent('d1', { confirmedAt: null }), null)).toEqual({
      message: T.stillClockedIn,
      clockOutNow: true,
    });
  });

  it('says nothing for a discard or a failure (the provider reports failures)', () => {
    const canceled = { ...base(), status: 'canceled', reason: 'user' } as FlowResult;
    const failed = {
      ...base(),
      status: 'failed',
      error: { code: 'runtime.error', message: 'x' },
    } as FlowResult;
    expect(clockFlowNotice('clock.wrapup', canceled, null)).toBeNull();
    expect(clockFlowNotice('clock.wrapup', failed, null)).toBeNull();
  });
});

describe('noteClockSend / takeClockSend', () => {
  it("hands back a draft's clock answer once", () => {
    const answer = outcome('d-note', 'clock.wrapup', { endTime: at(17, 2) });
    noteClockSend(answer);
    expect(takeClockSend('d-note')).toBe(answer);
    expect(takeClockSend('d-note')).toBeNull();
    expect(takeClockSend(null)).toBeNull();
  });

  it('keeps only the latest twenty', () => {
    for (let i = 0; i < 25; i += 1) noteClockSend(outcome(`d-cap-${i}`, 'clock.plan', {}));
    expect(takeClockSend('d-cap-0')).toBeNull();
    expect(takeClockSend('d-cap-24')?.draftId).toBe('d-cap-24');
  });
});

describe('clockUnsentCounts', () => {
  const draft = (state: DraftSummary['state'], over: Partial<DraftSummary> = {}) =>
    ({ id: `${state}-${Math.random()}`, state, ...over }) as DraftSummary;

  it('counts unsent clock videos, and the ones that need the person', () => {
    const drafts = [
      draft('draft'),
      draft('queued'),
      draft('failed'),
      draft('sent', {
        sent: { outcome: 'kept', dismissed: false } as DraftSummary['sent'],
      }),
      draft('sent', { sent: { outcome: 'kept', dismissed: true } as DraftSummary['sent'] }),
      draft('sent', { sent: { outcome: 'done', dismissed: false } as DraftSummary['sent'] }),
    ];
    expect(clockUnsentCounts(drafts)).toEqual({ count: 3, attention: 2 });
    expect(clockUnsentCounts([])).toEqual({ count: 0, attention: 0 });
  });

  it('reads every clock place on this phone, receipts included', () => {
    expect(CLOCK_DRAFTS_FILTER.contextKeyPrefix).toBe('clock');
    expect('clock-plan:t:2026-11-19'.startsWith(CLOCK_DRAFTS_FILTER.contextKeyPrefix!)).toBe(true);
    expect(CLOCK_DRAFTS_FILTER.states).toContain('sent');
  });
});

// ─── The button ───────────────────────────────────────────────────────────────

function embedWith(over: Partial<PulseEmbed> = {}): PulseEmbed {
  return {
    ...PULSE_EMBED_OFF,
    status: 'ready',
    client: {} as PulseClient,
    info: INFO,
    runtimePaused: false,
    teams: { [TEAM]: settings(true) },
    types: [typeInfo('clock.wrapup'), typeInfo('clock.plan')],
    open: vi.fn(async () => null),
    ...over,
  };
}

const clockedIn: UseClockPulseOptions = {
  session: { id: SESSION_ID, teamId: TEAM },
  teamId: TEAM,
  teamName: 'Platform',
  postDate: POST_DATE,
  onClockOutNow: vi.fn(),
};

function mountHook(embed: PulseEmbed, options: UseClockPulseOptions = clockedIn) {
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(PulseEmbedContext.Provider, { value: embed }, children);
  return renderHook((props: UseClockPulseOptions) => useClockPulse(props), {
    wrapper,
    initialProps: options,
  });
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

describe('useClockPulse', () => {
  beforeEach(() => {
    device.native = true;
    localStorage.clear();
    localStorage.setItem(PRE_PROMPT_SEEN_KEY, '1');
    resetPrePromptForTests();
    toasts.toast.mockClear();
    Object.values(clockCalls).forEach((call) => call.mockClear());
    setOnline(true);
  });

  afterEach(() => {
    cleanup();
    setOnline(true);
  });

  it('is absent while the team has "Clock in and out with a Pulse video" off', () => {
    const embed = embedWith({ teams: { [TEAM]: settings(false) } });
    expect(mountHook(embed).result.current).toBeNull();
    expect(mountHook(embed, { ...clockedIn, session: null }).result.current).toBeNull();
  });

  it('is absent where Pulse does not run in the app, or the server does not offer the type', () => {
    expect(mountHook(PULSE_EMBED_OFF).result.current).toBeNull();
    expect(mountHook(embedWith({ types: [typeInfo('clock.plan')] })).result.current).toBeNull();
    device.native = false;
    expect(mountHook(embedWith()).result.current).toBeNull();
  });

  it('offers Clock out with a Pulse video when clocked in, Clock in when not', () => {
    const embed = embedWith();
    const out = mountHook(embed).result.current;
    expect(out?.type).toBe('clock.wrapup');
    expect(out?.label).toBe('Clock out with a Pulse video');
    const into = mountHook(embed, { ...clockedIn, session: null }).result.current;
    expect(into?.type).toBe('clock.plan');
    expect(into?.label).toBe('Clock in with a Pulse video');
    // A team the person can't clock in to has nothing to record.
    expect(
      mountHook(embed, { ...clockedIn, session: null, teamId: null }).result.current,
    ).toBeNull();
  });

  it('is disabled offline, says why, and does not open Pulse', () => {
    const embed = embedWith();
    const { result } = mountHook(embed);
    act(() => setOnline(false));
    expect(result.current?.online).toBe(false);
    expect(result.current?.disabledReason).toBe('Needs a connection');
    act(() => result.current?.start());
    expect(embed.open).not.toHaveBeenCalled();
    act(() => setOnline(true));
    expect(result.current?.disabledReason).toBeNull();
  });

  it('records the wrap-up, then says the clock-out time the server returned', async () => {
    const answer = outcome('d-send', 'clock.wrapup', { endTime: at(17, 2) });
    const announced: boolean[] = [];
    const embed = embedWith({
      open: vi.fn(async (request) => {
        // What grants.ts's confirmSend does at Send, through the provider.
        noteClockSend(answer);
        const result = sent('d-send', {
          sentAt: at(16, 20),
          context: request.entry === 'record' ? request.context : undefined,
        });
        // What the provider asks before its own toast.
        announced.push(clockFlowAnnounced(result));
        return result;
      }),
    });
    const { result } = mountHook(embed);
    await act(async () => result.current?.start());

    expect(embed.open).toHaveBeenCalledWith({ entry: 'record', context: wrapUpPlace.context });
    expect(announced).toEqual([true]);
    expect(toasts.toast).toHaveBeenCalledTimes(1);
    expect(toasts.toast.mock.calls[0][0]).toMatchObject({
      message: `Clocked out at ${shown(at(17, 2))} · video sending`,
    });
    expect(toasts.toast.mock.calls[0][0].action).toBeUndefined();
    // Once the page has it, the provider speaks for this place again.
    expect(clockFlowAnnounced(sent('d-send'))).toBe(false);
    expect(Object.values(clockCalls).every((call) => call.mock.calls.length === 0)).toBe(true);
  });

  it('after a kept wrap-up says still clocked in, offers Clock out now, and never clocks itself', async () => {
    const onClockOutNow = vi.fn();
    const embed = embedWith({ open: vi.fn(async () => kept()) });
    const { result } = mountHook(embed, { ...clockedIn, onClockOutNow });
    await act(async () => result.current?.start());

    expect(toasts.toast).toHaveBeenCalledTimes(1);
    const shownToast = toasts.toast.mock.calls[0][0];
    expect(shownToast.message).toBe('Still clocked in');
    expect(shownToast.action.label).toBe('Clock out now');
    // Closing Pulse retries nothing: the clock stays as it was.
    expect(Object.values(clockCalls).every((call) => call.mock.calls.length === 0)).toBe(true);
    expect(onClockOutNow).not.toHaveBeenCalled();

    // Clock out now is the person's own plain clock-out.
    shownToast.action.onClick();
    expect(onClockOutNow).toHaveBeenCalledTimes(1);
  });

  it('records the plan for clock-plan:<teamId>:<postDate>', async () => {
    const embed = embedWith({ open: vi.fn(async () => kept(planPlace.context)) });
    const { result } = mountHook(embed, { ...clockedIn, session: null });
    await act(async () => result.current?.start());
    expect(embed.open).toHaveBeenCalledWith({ entry: 'record', context: planPlace.context });
    expect(planPlace.context.key).toBe(`clock-plan:${TEAM}:${POST_DATE}`);
    expect(planPlace.context.uploadType?.id).toBe('clock.plan');
    expect(toasts.toast.mock.calls[0][0]).toMatchObject({ message: 'Still clocked out' });
    expect(toasts.toast.mock.calls[0][0].action).toBeUndefined();
  });

  it('leaves a flow that could not open to the provider (it already said why)', async () => {
    const embed = embedWith({ open: vi.fn(async () => null) });
    const { result } = mountHook(embed);
    await act(async () => result.current?.start());
    expect(toasts.toast).not.toHaveBeenCalled();
    expect(result.current?.busy).toBe(false);
  });
});
