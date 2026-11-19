import type { DraftState, DraftSummary } from '@mieweb/pulse-embed';
import { createFakePulse, type FakePulseHandle } from '@mieweb/pulse-embed/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  anyTeamSharedDevice,
  decideSignOut,
  deleteUnsent,
  discardOnSharedPhone,
  dismissPulseSignOutNotice,
  noteSessionExpired,
  planSendNow,
  pulseSignOutNotice,
  rememberPulseForSignOut,
  reportPulseAccount,
  resetPulseSignOut,
  sendNowMode,
  sendUnsent,
  SIGN_OUT_TEXT,
  subscribePulseSignOutNotice,
  type SignOutFacts,
  type SignOutPlan,
} from './signOut';

const setPulseAccount = vi.hoisted(() => vi.fn((_userId: string | null) => Promise.resolve()));
vi.mock('./usePulseEmbed', () => ({ setPulseAccount }));

const context = { key: 'ticket:a', kind: 'ticket', id: 'a', label: 'Fix login' } as const;

const draft = (id: string, state: DraftState): DraftSummary => ({
  id,
  draftKey: `inst:${id}`,
  name: `Video ${id}`,
  context,
  state,
  clipCount: 1,
  durationMs: 1000,
  hasCaptions: false,
  poster: null,
  createdVia: 'host',
  createdAt: 1,
  updatedAt: 1,
});

const facts = (over: Partial<SignOutFacts>): SignOutFacts => ({
  initiator: 'user',
  available: true,
  shared: false,
  unsent: 3,
  online: true,
  ...over,
});

const signOut: SignOutPlan = { kind: 'signOut' };
const ask = (
  variant: 'personal' | 'shared',
  unsent: number,
  sendNow: 'queue' | 'offline',
): SignOutPlan => ({ kind: 'ask', variant, unsent, sendNow });

describe('decideSignOut', () => {
  it.each<[string, Partial<SignOutFacts>, SignOutPlan]>([
    // The person's own sign-out asks only when there is something unsent.
    ['user, unsent, online', {}, ask('personal', 3, 'queue')],
    ['user, unsent, offline', { online: false }, ask('personal', 3, 'offline')],
    ['user, shared phone, online', { shared: true }, ask('shared', 3, 'queue')],
    ['user, shared phone, offline', { shared: true, online: false }, ask('shared', 3, 'offline')],
    ['user, one unsent', { unsent: 1 }, ask('personal', 1, 'queue')],
    ['user, nothing unsent', { unsent: 0 }, signOut],
    ['user, shared phone, nothing unsent', { unsent: 0, shared: true }, signOut],
    ['user, count unknown', { unsent: null }, signOut],
    // The app's own sign-outs keep the drafts, shared phone or not.
    ['programmatic', { initiator: 'programmatic' }, signOut],
    ['programmatic, shared phone', { initiator: 'programmatic', shared: true }, signOut],
    ['programmatic, offline', { initiator: 'programmatic', online: false }, signOut],
    // A session that ends on its own keeps them, except on a shared phone.
    ['expiry', { initiator: 'expiry' }, signOut],
    ['expiry, nothing unsent', { initiator: 'expiry', unsent: 0 }, signOut],
    ['expiry, shared phone', { initiator: 'expiry', shared: true }, { kind: 'discard' }],
    [
      'expiry, shared phone, nothing unsent (a take may be open)',
      { initiator: 'expiry', shared: true, unsent: 0 },
      { kind: 'discard' },
    ],
    [
      'expiry, shared phone, offline',
      { initiator: 'expiry', shared: true, online: false },
      { kind: 'discard' },
    ],
    // Deleting the account purges.
    ['account deleted', { initiator: 'accountDeleted' }, { kind: 'purge' }],
    [
      'account deleted, nothing unsent',
      { initiator: 'accountDeleted', unsent: 0 },
      { kind: 'purge' },
    ],
    [
      'account deleted, shared phone',
      { initiator: 'accountDeleted', shared: true },
      { kind: 'purge' },
    ],
    // Without Pulse on this phone every sign-out is as it was.
    ['no Pulse, user', { available: false }, signOut],
    ['no Pulse, user, shared phone', { available: false, shared: true }, signOut],
    [
      'no Pulse, expiry, shared phone',
      { available: false, initiator: 'expiry', shared: true },
      signOut,
    ],
    ['no Pulse, account deleted', { available: false, initiator: 'accountDeleted' }, signOut],
  ])('%s', (_, over, plan) => {
    expect(decideSignOut(facts(over))).toEqual(plan);
  });

  it('Send now queues online and keeps the videos offline', () => {
    expect(sendNowMode(true)).toBe('queue');
    expect(sendNowMode(false)).toBe('offline');
  });
});

describe('anyTeamSharedDevice', () => {
  const settings = (pulseSharedDevice: boolean) => ({
    pulseInApp: true,
    pulseClockInOut: false,
    pulseSharedDevice,
  });

  it('is on when any one of the teams has Shared phones on', () => {
    expect(anyTeamSharedDevice({ t1: settings(false), t2: settings(true) })).toBe(true);
  });

  it('is off when no team has it, or before the server has answered', () => {
    expect(anyTeamSharedDevice({ t1: settings(false) })).toBe(false);
    expect(anyTeamSharedDevice({})).toBe(false);
    expect(anyTeamSharedDevice(null)).toBe(false);
  });
});

describe('planSendNow', () => {
  it('queues drafts, ready and failed videos, and counts the ones already on their way', () => {
    const plan = planSendNow([
      draft('d1', 'draft'),
      draft('d2', 'ready'),
      draft('d3', 'failed'),
      draft('d4', 'uploading'),
      draft('d5', 'queued'),
      draft('d6', 'waiting_network'),
      draft('d7', 'needs_credentials'),
      draft('d8', 'preparing'),
      draft('d9', 'delivering'),
      draft('d10', 'sent'),
    ]);
    expect(plan).toEqual({ send: ['d1', 'd2', 'd3'], onTheWay: 6, stuck: 0 });
  });

  it('leaves a state this build does not know alone, and counts it', () => {
    expect(planSendNow([draft('d1', 'archived' as DraftState)])).toEqual({
      send: [],
      onTheWay: 0,
      stuck: 1,
    });
  });
});

describe('Pulse at sign-out (fake Pulse)', () => {
  let fake: FakePulseHandle;
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    fake?.dispose();
    vi.restoreAllMocks();
  });

  it('Send now queues every unsent video, so each is on its way', async () => {
    fake = createFakePulse({
      online: true,
      drafts: [draft('d1', 'draft'), draft('d2', 'failed'), draft('d3', 'uploading')],
    });
    expect(await sendUnsent(fake.client)).toEqual({ notSent: 0 });
    const states = Object.fromEntries(fake.drafts().map((d) => [d.id, d.state]));
    expect(states).toEqual({ d1: 'queued', d2: 'queued', d3: 'uploading' });
    // Only the ones not on their way were asked for.
    const uploads = fake.calls.filter((c) => c.method === 'upload').map((c) => c.args);
    expect(uploads).toEqual([{ id: 'd1' }, { id: 'd2' }]);
  });

  it('counts a video Pulse refused as not sent, and one that started meanwhile as on its way', async () => {
    const upload = vi.fn((id: string) =>
      id === 'd1'
        ? Promise.reject({ code: 'host_misconfigured' })
        : id === 'd2'
          ? Promise.reject({ code: 'draft.locked' })
          : Promise.resolve({ clientKey: 'k', draftKey: `inst:${id}`, sentAt: 1 }),
    );
    const listDrafts = () =>
      Promise.resolve([draft('d1', 'draft'), draft('d2', 'ready'), draft('d3', 'ready')]);
    expect(await sendUnsent({ listDrafts, upload })).toEqual({ notSent: 1 });
    expect(upload).toHaveBeenCalledTimes(3);
  });

  it('says nothing was sent when the videos cannot be read', async () => {
    const upload = vi.fn();
    expect(await sendUnsent({ listDrafts: () => Promise.reject(new Error('x')), upload })).toEqual({
      notSent: null,
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it('Delete purges this account’s videos, and reports a refusal without throwing', async () => {
    fake = createFakePulse({ drafts: [draft('d1', 'draft'), draft('d2', 'ready')] });
    expect(await deleteUnsent(fake.client)).toBe(true);
    expect((await fake.client.usage()).unsent).toBe(0);
    expect(await deleteUnsent({ purge: () => Promise.reject({ code: 'busy' }) })).toBe(false);
  });

  it('a shared phone’s session end discards the open take, then deletes the unsent videos', async () => {
    fake = createFakePulse({
      drafts: [draft('d1', 'draft')],
      flows: [{ result: 'kept', afterMs: 60_000 } as never],
    });
    const flow = fake.client.open({ entry: 'record', context });
    await vi.waitFor(async () => expect(await fake.client.isOpen()).toBe(true));

    expect(await discardOnSharedPhone(fake.client)).toBe(
      SIGN_OUT_TEXT.discardedAndDeletedOnExpiry(1),
    );
    expect(SIGN_OUT_TEXT.discardedAndDeletedOnExpiry(1)).toBe(
      "Signed out. The recording and 1 video that wasn't sent were deleted because this phone is shared.",
    );
    expect(await flow).toMatchObject({ status: 'canceled', reason: 'host' });
    expect(fake.calls.find((c) => c.method === 'close')?.args).toEqual({
      reason: 'host',
      discard: true,
    });
    expect((await fake.client.usage()).unsent).toBe(0);
  });

  it('with a take open and nothing else unsent, says only the recording was deleted', async () => {
    fake = createFakePulse({
      drafts: [],
      flows: [{ result: 'kept', afterMs: 60_000 } as never],
    });
    void fake.client.open({ entry: 'record', context });
    await vi.waitFor(async () => expect(await fake.client.isOpen()).toBe(true));
    expect(await discardOnSharedPhone(fake.client)).toBe(SIGN_OUT_TEXT.discardedOnExpiry);
    expect(fake.calls.map((c) => c.method)).not.toContain('purge');
  });

  it('with no take open, says how many unsent videos were deleted', async () => {
    fake = createFakePulse({ drafts: [draft('d1', 'draft'), draft('d2', 'ready')] });
    expect(await discardOnSharedPhone(fake.client)).toBe(SIGN_OUT_TEXT.deletedOnExpiry(2));
    expect(fake.calls.map((c) => c.method)).not.toContain('close');
    expect((await fake.client.usage()).drafts).toBe(0);
  });

  it('with nothing open and nothing unsent, deletes nothing and says nothing', async () => {
    fake = createFakePulse({ drafts: [] });
    expect(await discardOnSharedPhone(fake.client)).toBeNull();
    expect(fake.calls.map((c) => c.method)).not.toContain('purge');
  });

  it('when the count cannot be read, still deletes on a shared phone', async () => {
    const client = {
      isOpen: () => Promise.resolve(false),
      close: vi.fn(),
      usage: () => Promise.reject(new Error('x')),
      purge: vi.fn(() => Promise.resolve()),
    };
    expect(await discardOnSharedPhone(client)).toBeNull();
    expect(client.purge).toHaveBeenCalled();
  });
});

describe('reportPulseAccount', () => {
  const endClient = () => {
    const calls: string[] = [];
    return {
      calls,
      client: {
        isOpen: async () => (calls.push('isOpen'), true),
        close: async (o?: unknown) => void calls.push(`close ${JSON.stringify(o)}`),
        usage: async () => (calls.push('usage'), { unsent: 2 } as never),
        purge: async () => void calls.push('purge'),
      },
    };
  };

  beforeEach(() => {
    resetPulseSignOut();
    setPulseAccount.mockClear();
    setPulseAccount.mockImplementation(() => Promise.resolve());
  });

  it('passes the account on, in order', async () => {
    void reportPulseAccount('u1');
    await reportPulseAccount('u2');
    expect(setPulseAccount.mock.calls).toEqual([['u1'], ['u2']]);
  });

  it('on a shared phone, a session the server ended discards before Pulse forgets the account', async () => {
    const { calls, client } = endClient();
    setPulseAccount.mockImplementation(async (id) => void calls.push(`setAccount ${id}`));
    await reportPulseAccount('u1');
    rememberPulseForSignOut({ userId: 'u1', client, shared: true });
    noteSessionExpired();
    await reportPulseAccount(null);
    expect(calls).toEqual([
      'setAccount u1',
      'isOpen',
      'close {"reason":"host","discard":true}',
      'usage',
      'purge',
      'setAccount null',
    ]);
    expect(pulseSignOutNotice()).toBe(SIGN_OUT_TEXT.discardedAndDeletedOnExpiry(2));
  });

  it('a sign-out the server did not state (signOut, a network error) keeps the drafts', async () => {
    const { calls, client } = endClient();
    await reportPulseAccount('u1');
    rememberPulseForSignOut({ userId: 'u1', client, shared: true });
    await reportPulseAccount(null);
    expect(calls).toEqual([]);
    expect(setPulseAccount).toHaveBeenLastCalledWith(null);
    expect(pulseSignOutNotice()).toBeNull();
  });

  it('a session that ended on a personal phone keeps the drafts', async () => {
    const { calls, client } = endClient();
    await reportPulseAccount('u1');
    rememberPulseForSignOut({ userId: 'u1', client, shared: false });
    noteSessionExpired();
    await reportPulseAccount(null);
    expect(calls).toEqual([]);
    expect(setPulseAccount).toHaveBeenLastCalledWith(null);
  });

  it('a page that starts signed out deletes nothing', async () => {
    const { calls, client } = endClient();
    rememberPulseForSignOut({ userId: 'u1', client, shared: true });
    noteSessionExpired();
    await reportPulseAccount(null);
    expect(calls).toEqual([]);
  });

  it('a server end noted while no one was signed in does not reach the next session', async () => {
    const { calls, client } = endClient();
    noteSessionExpired();
    await reportPulseAccount('u1');
    rememberPulseForSignOut({ userId: 'u1', client, shared: true });
    await reportPulseAccount(null);
    expect(calls).toEqual([]);
  });

  it('never acts on another person’s Pulse', async () => {
    const { calls, client } = endClient();
    await reportPulseAccount('u2');
    rememberPulseForSignOut({ userId: 'u1', client, shared: true });
    noteSessionExpired();
    await reportPulseAccount(null);
    expect(calls).toEqual([]);
  });

  it('the next sign-in clears the notice, and the notice tells its listeners', async () => {
    const { client } = endClient();
    const listener = vi.fn();
    const off = subscribePulseSignOutNotice(listener);
    await reportPulseAccount('u1');
    rememberPulseForSignOut({ userId: 'u1', client, shared: true });
    noteSessionExpired();
    await reportPulseAccount(null);
    expect(pulseSignOutNotice()).not.toBeNull();
    await reportPulseAccount('u2');
    expect(pulseSignOutNotice()).toBeNull();
    expect(listener).toHaveBeenCalled();
    off();
  });

  it('the notice can be dismissed', async () => {
    const { client } = endClient();
    await reportPulseAccount('u1');
    rememberPulseForSignOut({ userId: 'u1', client, shared: true });
    noteSessionExpired();
    await reportPulseAccount(null);
    dismissPulseSignOutNotice();
    expect(pulseSignOutNotice()).toBeNull();
  });

  it('keeps reporting after a report failed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    setPulseAccount.mockImplementationOnce(() => Promise.reject(new Error('x')));
    await reportPulseAccount('u1');
    await reportPulseAccount('u2');
    expect(setPulseAccount).toHaveBeenLastCalledWith('u2');
    vi.restoreAllMocks();
  });
});
