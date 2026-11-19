import type { DraftState, DraftSummary, PulseClient } from '@mieweb/pulse-embed';
import { createFakePulse, type FakePulseHandle } from '@mieweb/pulse-embed/testing';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { orgApi, type PulseTeamSettings } from '../../lib/api';
import { SessionProvider, useSession } from '../../lib/useSession';
import {
  noteSessionExpired,
  rememberPulseForSignOut,
  reportPulseAccount,
  resetPulseSignOut,
  SIGN_OUT_TEXT,
} from './signOut';
import {
  PulseSignOutNotice,
  SignOutPulseDialog,
  usePulseSignOut,
  type SignOutPulseDialogProps,
} from './SignOutPulseDialog';
import {
  PULSE_EMBED_OFF,
  PulseEmbedContext,
  resetPulseAccount,
  type PulseEmbed,
} from './usePulseEmbed';

// The session tests hand SessionProvider a fake DDP client; nothing else here uses it.
const fakeDdp = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('../../lib/ddp', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/ddp')>();
  return { ...real, getDdpClient: () => fakeDdp.current ?? real.getDdpClient() };
});

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

const team = (over: Partial<PulseTeamSettings> = {}): PulseTeamSettings => ({
  pulseInApp: true,
  pulseClockInOut: false,
  pulseSharedDevice: false,
  ...over,
});

const button = (name: string) => screen.getByRole('button', { name });
const queryButton = (name: string) => screen.queryByRole('button', { name });
const dialog = () => screen.queryByRole('dialog');

// ─── The dialog alone ─────────────────────────────────────────────────────────

describe('SignOutPulseDialog', () => {
  afterEach(cleanup);

  const props = (over: Partial<SignOutPulseDialogProps> = {}): SignOutPulseDialogProps => ({
    open: true,
    variant: 'personal',
    unsent: 3,
    step: 'choose',
    error: null,
    onSendNow: vi.fn(),
    onKeep: vi.fn(),
    onDelete: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  });

  it('personal: says how many have not been sent, with Send now, Keep and Delete', () => {
    const p = props();
    render(<SignOutPulseDialog {...p} />);
    expect(within(dialog()!).getByText("3 videos haven't been sent")).toBeTruthy();
    fireEvent.click(button('Send now'));
    fireEvent.click(button('Keep for next sign-in'));
    fireEvent.click(button('Delete'));
    expect(p.onSendNow).toHaveBeenCalledTimes(1);
    expect(p.onKeep).toHaveBeenCalledTimes(1);
    expect(p.onDelete).toHaveBeenCalledTimes(1);
    expect(queryButton('Delete and sign out')).toBeNull();
  });

  it('personal, one video: singular words', () => {
    render(<SignOutPulseDialog {...props({ unsent: 1 })} />);
    expect(screen.getByText("1 video hasn't been sent")).toBeTruthy();
  });

  it('shared: says the videos will be deleted, with Send now, Delete and sign out, Cancel', () => {
    const p = props({ variant: 'shared' });
    render(<SignOutPulseDialog {...p} />);
    expect(
      screen.getByText('This phone is shared, so 3 unsent videos will be deleted'),
    ).toBeTruthy();
    expect(queryButton('Keep for next sign-in')).toBeNull();
    fireEvent.click(button('Delete and sign out'));
    expect(p.onDelete).toHaveBeenCalledTimes(1);
    // Two ways to cancel: the footer's button and the header's close.
    screen.getAllByRole('button', { name: 'Cancel' }).forEach((b) => fireEvent.click(b));
    expect(p.onCancel).toHaveBeenCalledTimes(2);
  });

  it('offline: announces that the videos are kept, and offers Sign out or Cancel', () => {
    const p = props({ step: 'offline' });
    render(<SignOutPulseDialog {...p} />);
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe(SIGN_OUT_TEXT.offline);
    expect(queryButton('Send now')).toBeNull();
    fireEvent.click(button('Sign out'));
    expect(p.onKeep).toHaveBeenCalledTimes(1);
  });

  it('announces an error as an alert', () => {
    render(<SignOutPulseDialog {...props({ error: SIGN_OUT_TEXT.deleteFailed })} />);
    expect(screen.getByRole('alert').textContent).toBe(SIGN_OUT_TEXT.deleteFailed);
  });

  it('while sending, every choice waits', () => {
    const p = props({ step: 'sending' });
    render(<SignOutPulseDialog {...p} />);
    for (const b of within(dialog()!).getAllByRole('button')) {
      expect((b as HTMLButtonElement).disabled).toBe(true);
    }
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(p.onCancel).not.toHaveBeenCalled();
  });
});

// ─── The hook, as the user menu and Settings use it ───────────────────────────

let api: ReturnType<typeof usePulseSignOut>;
function SignOutButton(props: Parameters<typeof usePulseSignOut>[0]) {
  api = usePulseSignOut(props);
  return (
    <>
      <button type="button" onClick={() => void api.requestSignOut()}>
        Account sign out
      </button>
      {api.dialog}
    </>
  );
}

describe('usePulseSignOut', () => {
  let fake: FakePulseHandle | null = null;
  let online = true;
  const signOut = vi.fn(() => Promise.resolve());

  function mount(
    embed: Partial<PulseEmbed>,
    options: { userId?: string | null; client?: PulseClient } = {},
  ) {
    const value: PulseEmbed = { ...PULSE_EMBED_OFF, ...embed };
    render(
      <PulseEmbedContext.Provider value={value}>
        <SignOutButton
          userId={options.userId === undefined ? 'u1' : options.userId}
          signOut={signOut}
          online={() => online}
        />
      </PulseEmbedContext.Provider>,
    );
  }

  function mountFake(
    drafts: DraftSummary[],
    teams: Record<string, PulseTeamSettings> = { t1: team() },
  ) {
    fake = createFakePulse({ online: true, drafts });
    mount({ status: 'ready', client: fake.client, teams, usage: null });
    return fake;
  }

  const tapSignOut = () => act(async () => fireEvent.click(button('Account sign out')));
  const tap = (name: string) => act(async () => fireEvent.click(button(name)));
  const methods = () => fake!.calls.map((c) => c.method);

  beforeEach(() => {
    online = true;
    signOut.mockClear();
    resetPulseSignOut();
    resetPulseAccount();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    fake?.dispose();
    fake = null;
    vi.restoreAllMocks();
  });

  it('without Pulse (a browser), signs out at once, as before', async () => {
    mount({ status: 'off' });
    await tapSignOut();
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });

  it('while Pulse is still starting, signs out at once and keeps the drafts', async () => {
    fake = createFakePulse({ drafts: [draft('d1', 'draft')] });
    mount({ status: 'starting', client: null, usage: { unsent: 1 } as never });
    await tapSignOut();
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });

  it('with nothing unsent, signs out at once', async () => {
    mountFake([draft('d1', 'sent')]);
    await tapSignOut();
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
    expect(methods()).not.toContain('purge');
  });

  it('with unsent videos, asks first and does not sign out yet', async () => {
    mountFake([draft('d1', 'draft'), draft('d2', 'ready')]);
    await tapSignOut();
    expect(screen.getByText("2 videos haven't been sent")).toBeTruthy();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('when Pulse does not answer the count in time, asks with the last count it read', async () => {
    const client = { usage: () => new Promise(() => {}) } as unknown as PulseClient;
    render(
      <PulseEmbedContext.Provider
        value={{ ...PULSE_EMBED_OFF, status: 'ready', client, usage: { unsent: 2 } as never }}
      >
        <SignOutButton userId="u1" signOut={signOut} usageWaitMs={10} />
      </PulseEmbedContext.Provider>,
    );
    await tapSignOut();
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(screen.getByText("2 videos haven't been sent")).toBeTruthy();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('asks even with "Pulse in the app" off on every team (AD25)', async () => {
    mountFake([draft('d1', 'draft')], { t1: team({ pulseInApp: false }) });
    await tapSignOut();
    expect(screen.getByText("1 video hasn't been sent")).toBeTruthy();
  });

  it('Send now queues each video, then signs out', async () => {
    mountFake([draft('d1', 'draft'), draft('d2', 'failed'), draft('d3', 'uploading')]);
    await tapSignOut();
    await tap('Send now');
    expect(signOut).toHaveBeenCalledTimes(1);
    const states = fake!.drafts().map((d) => d.state);
    expect(states.sort()).toEqual(['queued', 'queued', 'uploading']);
    // Queued before the sign-out: every upload call came back first.
    expect(methods().filter((m) => m === 'upload')).toHaveLength(2);
    expect(methods()).not.toContain('purge');
  });

  it('Send now offline keeps the videos, says so, and signs out only when asked', async () => {
    mountFake([draft('d1', 'draft')]);
    await tapSignOut();
    online = false;
    await tap('Send now');
    expect(screen.getByRole('status').textContent).toBe(SIGN_OUT_TEXT.offline);
    expect(methods()).not.toContain('upload');
    expect(signOut).not.toHaveBeenCalled();
    await tap('Sign out');
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(methods()).not.toContain('purge');
    expect(fake!.drafts().map((d) => d.state)).toEqual(['draft']);
  });

  it('Send now that cannot queue a video stays, says so, and keeps it', async () => {
    mountFake([draft('d1', 'draft')]);
    await tapSignOut();
    vi.spyOn(fake!.client, 'upload').mockRejectedValue({ code: 'host_misconfigured' });
    await tap('Send now');
    expect(signOut).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(SIGN_OUT_TEXT.notSent(1));
    expect(button('Keep for next sign-in')).toBeTruthy();
  });

  it('Keep for next sign-in signs out and leaves the videos on this phone', async () => {
    mountFake([draft('d1', 'draft')]);
    await tapSignOut();
    await tap('Keep for next sign-in');
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(methods()).not.toContain('purge');
    expect(fake!.drafts()).toHaveLength(1);
  });

  it('Delete purges the videos, then signs out', async () => {
    mountFake([draft('d1', 'draft'), draft('d2', 'ready')]);
    const order: string[] = [];
    signOut.mockImplementationOnce(async () => void order.push('signOut'));
    const purge = fake!.client.purge.bind(fake!.client);
    vi.spyOn(fake!.client, 'purge').mockImplementation(async (o) => {
      order.push('purge');
      return purge(o);
    });
    await tapSignOut();
    await tap('Delete');
    expect(order).toEqual(['purge', 'signOut']);
    expect((await fake!.client.usage()).unsent).toBe(0);
  });

  it('Delete that Pulse refuses stays signed in and says so', async () => {
    mountFake([draft('d1', 'draft')]);
    await tapSignOut();
    vi.spyOn(fake!.client, 'purge').mockRejectedValue({ code: 'busy' });
    await tap('Delete');
    expect(signOut).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(SIGN_OUT_TEXT.deleteFailed);
  });

  it('shared phone: the delete variant; Delete and sign out purges, then signs out', async () => {
    mountFake([draft('d1', 'draft')], { t1: team(), t2: team({ pulseSharedDevice: true }) });
    await tapSignOut();
    expect(
      screen.getByText('This phone is shared, so 1 unsent video will be deleted'),
    ).toBeTruthy();
    await tap('Delete and sign out');
    expect(methods()).toContain('purge');
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('shared phone: Cancel stays signed in and keeps everything', async () => {
    mountFake([draft('d1', 'draft')], { t1: team({ pulseSharedDevice: true }) });
    await tapSignOut();
    await act(async () => fireEvent.click(within(dialog()!).getAllByText('Cancel')[0]));
    expect(dialog()).toBeNull();
    expect(signOut).not.toHaveBeenCalled();
    expect(fake!.drafts()).toHaveLength(1);
  });

  it('deleting the account purges this account’s videos; without Pulse it does nothing', async () => {
    mountFake([draft('d1', 'draft')]);
    await act(() => api.purgeDeletedAccount());
    expect(methods()).toContain('purge');
    expect((await fake!.client.usage()).drafts).toBe(0);
    cleanup();

    const purge = vi.fn();
    mount({ status: 'off', client: { purge } as unknown as PulseClient });
    await act(() => api.purgeDeletedAccount());
    expect(purge).not.toHaveBeenCalled();
  });

  it('a shared phone whose session ends mid-take discards it and says so on the sign-in screen', async () => {
    fake = createFakePulse({
      drafts: [draft('d1', 'draft')],
      flows: [{ result: 'kept', afterMs: 60_000 } as never],
    });
    await reportPulseAccount('u1');
    mount({
      status: 'ready',
      client: fake.client,
      teams: { t1: team({ pulseSharedDevice: true }) },
    });
    const flow = fake.client.open({ entry: 'record', context });
    await vi.waitFor(async () => expect(await fake!.client.isOpen()).toBe(true));
    // The server ends the session: the app unmounts, then the session reports no one.
    cleanup();
    render(<PulseSignOutNotice />);
    noteSessionExpired();
    await act(() => reportPulseAccount(null));

    expect(await flow).toMatchObject({ status: 'canceled', reason: 'host' });
    expect((await fake.client.usage()).unsent).toBe(0);
    expect(screen.getByRole('alert').textContent).toBe(
      SIGN_OUT_TEXT.discardedAndDeletedOnExpiry(1),
    );
    fireEvent.click(button('Dismiss'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a personal phone whose session ends keeps the take and the drafts', async () => {
    fake = createFakePulse({ drafts: [draft('d1', 'draft')] });
    await reportPulseAccount('u1');
    mount({ status: 'ready', client: fake.client, teams: { t1: team() } });
    cleanup();
    render(<PulseSignOutNotice />);
    noteSessionExpired();
    await act(() => reportPulseAccount(null));
    expect(methods()).not.toContain('purge');
    expect(methods()).not.toContain('close');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

// ─── The session: which "no one signed in" answers are an expiry ──────────────

describe('SessionProvider and a shared phone', () => {
  const TOKEN = 'meteor_resume_token';
  let fake: FakePulseHandle;
  let refetch: () => Promise<void>;
  let getCurrentUser: ReturnType<typeof vi.fn>;

  function Probe() {
    const session = useSession();
    refetch = session.refetch;
    return (
      <span data-testid="who">{session.loading ? 'loading' : (session.user?.id ?? 'none')}</span>
    );
  }

  const notice = () => screen.queryByRole('alert')?.textContent ?? null;
  /** The order of reports drains: a repeat of "no one" acts on nothing. */
  const settled = () => act(() => reportPulseAccount(null));

  beforeEach(async () => {
    resetPulseSignOut();
    resetPulseAccount();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(orgApi, 'listOrganizations').mockResolvedValue([]);
    localStorage.setItem(TOKEN, 'resume-1');
    getCurrentUser = vi.fn(async () => ({
      id: 'u1',
      email: 'a@example.com',
      name: 'A',
      username: 'a',
      image: null,
      emailVerified: true,
      createdAt: null,
      releaseNotesSeenVersion: null,
    }));
    fakeDdp.current = {
      getCurrentUser,
      onReconnect: () => () => {},
      logout: async () => {},
      markNativeAppSeen: async () => {},
    };
    fake = createFakePulse({ drafts: [draft('d1', 'draft')] });
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    await vi.waitFor(() => expect(screen.getByTestId('who').textContent).toBe('u1'));
    // What the signed-in app keeps fresh (usePulseSignOut): this phone is shared.
    rememberPulseForSignOut({ userId: 'u1', client: fake.client, shared: true });
  });
  afterEach(() => {
    cleanup();
    fake.dispose();
    fakeDdp.current = null;
    localStorage.removeItem(TOKEN);
    vi.restoreAllMocks();
  });

  it('a network error (the token is kept) signs out for now and keeps the videos', async () => {
    // A dropped socket or failed connect: getCurrentUser answers null and leaves the token.
    getCurrentUser.mockResolvedValue(null);
    await act(() => refetch());
    expect(screen.getByTestId('who').textContent).toBe('none');
    await settled();
    expect(fake.calls.map((c) => c.method)).not.toContain('purge');
    expect((await fake.client.usage()).unsent).toBe(1);
    expect(localStorage.getItem(TOKEN)).toBe('resume-1');
    expect(notice()).toBeNull();
  });

  it('a refused session (the token is dropped) deletes the unsent videos and says so', async () => {
    // The server refused the resume login: the client drops the token, then answers null.
    getCurrentUser.mockImplementation(async () => {
      localStorage.removeItem(TOKEN);
      return null;
    });
    await act(() => refetch());
    expect(screen.getByTestId('who').textContent).toBe('none');
    await settled();
    expect(fake.calls.map((c) => c.method)).toContain('purge');
    expect((await fake.client.usage()).unsent).toBe(0);
    expect(notice()).toBe(SIGN_OUT_TEXT.deletedOnExpiry(1));
  });
});
