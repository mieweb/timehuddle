import type { FlowResult, PulseClient, PulseContext } from '@mieweb/pulse-embed';
import { createFakePulse, type FakePulseHandle } from '@mieweb/pulse-embed/testing';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PulseUploadTypesList } from '../../lib/api';
import { cssColorToHex, PulseEmbedProvider, pulseConfigureOptions } from './PulseEmbedProvider';
import {
  resetPulseAccount,
  setPulseAccount,
  type PulseEmbed,
  usePulseDrafts,
  usePulseEmbed,
  useQueuedNavigate,
} from './usePulseEmbed';

const context: PulseContext = { key: 'ticket:abc', kind: 'ticket', id: 'abc', label: 'Fix login' };

const on = { pulseInApp: true, pulseClockInOut: false, pulseSharedDevice: false };
const off = { pulseInApp: false, pulseClockInOut: false, pulseSharedDevice: false };

const typesList = (over: Partial<PulseUploadTypesList> = {}): PulseUploadTypesList => ({
  types: [],
  runtimePaused: false,
  teams: { t1: on },
  ...over,
});

const noServices = {
  getUploadTarget: () => Promise.reject({ code: 'host.unavailable', message: 'test' }),
  refreshUploadToken: () => Promise.reject({ code: 'host.unavailable', message: 'test' }),
};

const methods = (fake: FakePulseHandle) => fake.calls.map((c) => c.method);
const count = (fake: FakePulseHandle, method: string) =>
  fake.calls.filter((c) => c.method === method).length;

/** Lets the provider's start sequence (a chain of awaited calls) run out. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 30)));

let embed: PulseEmbed;
function Probe({ drafts = false }: { drafts?: boolean }) {
  embed = usePulseEmbed();
  const { drafts: rows } = usePulseDrafts(drafts ? {} : null);
  return (
    <p data-testid="probe" data-status={embed.status}>
      {rows.length}
    </p>
  );
}

function mount(
  client: PulseClient,
  options: { loadTypes?: () => Promise<PulseUploadTypesList>; drafts?: boolean } = {},
) {
  const loadTypes = vi.fn(options.loadTypes ?? (() => Promise.resolve(typesList())));
  render(
    <PulseEmbedProvider enabled client={client} services={noServices} loadTypes={loadTypes}>
      <Probe drafts={options.drafts} />
    </PulseEmbedProvider>,
  );
  return { loadTypes };
}

const status = () => screen.getByTestId('probe').getAttribute('data-status');

describe('PulseEmbedProvider', () => {
  let fakes: FakePulseHandle[] = [];
  const fakePulse = (...args: Parameters<typeof createFakePulse>) => {
    const fake = createFakePulse(...args);
    fakes.push(fake);
    return fake;
  };

  beforeEach(() => {
    resetPulseAccount();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    fakes.forEach((f) => f.dispose());
    fakes = [];
    vi.restoreAllMocks();
  });

  it('configures, then sets the account, before the first read of drafts', async () => {
    const fake = fakePulse({ account: null });
    void setPulseAccount('u1');
    mount(fake.client, { drafts: true });

    await vi.waitFor(() => expect(methods(fake)).toContain('listDrafts'));
    const order = methods(fake);
    const configure = order.indexOf('configure');
    const setAccount = order.indexOf('setAccount');
    expect(configure).toBeGreaterThanOrEqual(0);
    expect(setAccount).toBeGreaterThan(configure);
    expect(order.indexOf('listDrafts')).toBeGreaterThan(setAccount);
    expect(fake.calls[setAccount].args).toMatchObject({ userId: 'u1' });
    expect(fake.calls[configure].args).toMatchObject({
      hostId: 'com.mieweb.timehuddle',
      hostName: 'TimeHuddle',
      uploadMode: 'pulse',
      policy: { allowShare: true, allowSaveToPhotos: true },
      captions: { autoDownload: 'wifi' },
    });
    expect(status()).toBe('ready');
  });

  it('reads nothing while no one is signed in', async () => {
    const fake = fakePulse({ account: null });
    mount(fake.client, { drafts: true });
    await settle();
    expect(methods(fake)).toContain('configure');
    expect(methods(fake)).not.toContain('setAccount');
    expect(methods(fake)).not.toContain('listDrafts');
    expect(status()).toBe('starting');
  });

  it('drains the inbox after a reload and acknowledges each result once', async () => {
    // A flow ends while the WebView reloads: the result is in the inbox and
    // retained as a flowResult event for the next page (a capgo reload).
    const fake = fakePulse({ flows: [{ result: 'kept', afterMs: 20 }] });
    void fake.client.record(context);
    await vi.waitFor(async () => expect(await fake.client.isOpen()).toBe(true));
    const page = fake.reload();
    await fake.idle();
    expect(await page.pendingResults()).toHaveLength(1);

    void setPulseAccount('u1');
    mount(page);
    await vi.waitFor(() => expect(count(fake, 'acknowledge')).toBe(1));
    await settle();
    expect(count(fake, 'acknowledge')).toBe(1);
    expect(await page.pendingResults()).toEqual([]);
  });

  it('drains a result only the inbox holds (no reply, no event reached any page)', async () => {
    const fake = fakePulse({ flows: [{ result: 'kept' }] });
    fake.dropNextResult();
    void fake.client.record(context);
    await vi.waitFor(async () => expect(await fake.client.pendingResults()).toHaveLength(1));
    const page = fake.reload();

    void setPulseAccount('u1');
    mount(page);
    await vi.waitFor(() => expect(count(fake, 'acknowledge')).toBe(1));
    await settle();
    expect(count(fake, 'acknowledge')).toBe(1);
    expect(await page.pendingResults()).toEqual([]);
  });

  it('skips resumeOutbox, prewarm and cleanup while Pulse is paused for everyone', async () => {
    const fake = fakePulse();
    void setPulseAccount('u1');
    const { loadTypes } = mount(fake.client, {
      loadTypes: () => Promise.resolve(typesList({ runtimePaused: true })),
    });
    await vi.waitFor(() => expect(loadTypes).toHaveBeenCalled());
    await settle();
    expect(methods(fake)).not.toContain('resumeOutbox');
    expect(methods(fake)).not.toContain('prewarm');
    expect(methods(fake)).not.toContain('purge');
    expect(methods(fake)).not.toContain('listNamespaces');
    // The catalog is still read: unsent videos stay visible.
    expect(methods(fake)).toContain('usage');
    expect(embed.runtimePaused).toBe(true);
  });

  it('still resumes the outbox with Pulse in the app off on every team (AD25)', async () => {
    const fake = fakePulse({
      drafts: [{ ...draftSeed('d1'), state: 'ready' }],
    });
    void setPulseAccount('u1');
    mount(fake.client, {
      loadTypes: () => Promise.resolve(typesList({ teams: { t1: off, t2: off } })),
    });
    await vi.waitFor(() => expect(methods(fake)).toContain('resumeOutbox'));
    await settle();
    // No record buttons, so nothing to prewarm for.
    expect(methods(fake)).not.toContain('prewarm');
    expect(methods(fake)).toContain('listNamespaces');
  });

  it('resumes and prewarms with the setting on', async () => {
    const fake = fakePulse();
    void setPulseAccount('u1');
    mount(fake.client);
    await vi.waitFor(() => expect(methods(fake)).toContain('prewarm'));
    expect(methods(fake)).toContain('resumeOutbox');
    expect(embed.surfacesVisible).toBe(true);
  });

  it('wakes nothing in the background until the server has answered', async () => {
    const fake = fakePulse();
    void setPulseAccount('u1');
    const { loadTypes } = mount(fake.client, {
      loadTypes: () => Promise.reject(new Error('offline')),
    });
    await vi.waitFor(() => expect(loadTypes).toHaveBeenCalled());
    await settle();
    expect(methods(fake)).not.toContain('resumeOutbox');
  });

  it('sets the account to null on sign-out', async () => {
    const fake = fakePulse({ account: null });
    void setPulseAccount('u1');
    mount(fake.client);
    await vi.waitFor(() => expect(status()).toBe('ready'));

    await act(() => setPulseAccount(null));
    const accounts = fake.calls.filter((c) => c.method === 'setAccount').map((c) => c.args);
    expect(accounts).toHaveLength(2);
    expect(accounts[1]).not.toHaveProperty('userId');
    expect(status()).toBe('starting');
  });

  it('closes an open flow with reason "host" at logout, before forgetting the account', async () => {
    const fake = fakePulse({ flows: [{ result: 'kept', afterMs: 60_000 }] });
    void setPulseAccount('u1');
    mount(fake.client);
    await vi.waitFor(() => expect(status()).toBe('ready'));

    let result: Promise<FlowResult | null> = Promise.resolve(null);
    act(() => {
      result = embed.open({ entry: 'record', context });
    });
    await vi.waitFor(async () => expect(await fake.client.isOpen()).toBe(true));
    expect(embed.isOpen).toBe(true);

    await act(() => setPulseAccount(null));
    const order = methods(fake);
    const close = order.lastIndexOf('close');
    expect(fake.calls[close].args).toEqual({ reason: 'host' });
    expect(order.lastIndexOf('setAccount')).toBeGreaterThan(close);
    expect(await result).toMatchObject({ status: 'closed', reason: 'host' });
  });

  it('holds a navigation while Pulse is open and applies it when the flow ends', async () => {
    const fake = fakePulse({ flows: [{ result: 'kept', afterMs: 60_000 }] });
    const go = vi.fn();
    let queued: (path: string) => void = () => {};
    function Nav() {
      queued = useQueuedNavigate(go);
      return null;
    }
    void setPulseAccount('u1');
    render(
      <PulseEmbedProvider
        enabled
        client={fake.client}
        services={noServices}
        loadTypes={() => Promise.resolve(typesList())}
      >
        <Probe />
        <Nav />
      </PulseEmbedProvider>,
    );
    await vi.waitFor(() => expect(status()).toBe('ready'));

    let result: Promise<FlowResult | null> = Promise.resolve(null);
    act(() => {
      result = embed.open({ entry: 'record', context });
    });
    act(() => queued('/app/huddle?postId=p1'));
    expect(go).not.toHaveBeenCalled();

    await act(() => fake.client.close());
    await act(async () => {
      await result;
    });
    expect(go).toHaveBeenCalledExactlyOnceWith('/app/huddle?postId=p1');
    // The result came back twice (the open promise and the flowResult event): handled once.
    await settle();
    expect(count(fake, 'acknowledge')).toBe(1);

    act(() => queued('/app/notifications'));
    expect(go).toHaveBeenLastCalledWith('/app/notifications');
  });

  it('never touches Pulse outside the native app', async () => {
    const fake = fakePulse();
    void setPulseAccount('u1');
    render(
      <PulseEmbedProvider enabled={false} client={fake.client} loadTypes={vi.fn()}>
        <Probe drafts />
      </PulseEmbedProvider>,
    );
    await settle();
    expect(fake.calls).toEqual([]);
    expect(status()).toBe('off');
    expect(embed.surfacesVisible).toBe(false);
  });

  it('stays hidden without the plugin', async () => {
    const fake = fakePulse({ info: { supported: false, unsupportedReason: 'os' } });
    void setPulseAccount('u1');
    mount(fake.client, { drafts: true });
    await vi.waitFor(() => expect(status()).toBe('unavailable'));
    expect(methods(fake)).not.toContain('configure');
    expect(embed.surfacesVisible).toBe(false);
  });

  it('shows the surfaces while videos are unsent even with the setting off (AD25)', async () => {
    const fake = fakePulse({ flows: [{ result: 'kept' }] });
    void setPulseAccount('u1');
    mount(fake.client, {
      loadTypes: () => Promise.resolve(typesList({ teams: { t1: off } })),
    });
    await vi.waitFor(() => expect(embed.usage).not.toBeNull());
    expect(embed.surfacesVisible).toBe(false);

    // A take kept as a draft: one unsent video on this phone.
    await act(async () => {
      await embed.open({ entry: 'record', context });
    });
    await vi.waitFor(() => expect(embed.usage?.unsent).toBe(1));
    expect(embed.surfacesVisible).toBe(true);
  });
});

describe('pulseConfigureOptions / cssColorToHex', () => {
  it('passes the theme it is given', () => {
    expect(pulseConfigureOptions({ accent: '#27aae1' }).theme).toEqual({ accent: '#27aae1' });
  });

  it('reads computed colours as #rrggbb', () => {
    expect(cssColorToHex('rgb(39, 170, 225)')).toBe('#27aae1');
    expect(cssColorToHex('rgba(39, 170, 225, 1)')).toBe('#27aae1');
    expect(cssColorToHex('#ABC')).toBe('#aabbcc');
    expect(cssColorToHex('rgba(0, 0, 0, 0)')).toBeUndefined();
    expect(cssColorToHex('oklch(0.7 0.1 200)')).toBeUndefined();
  });
});

function draftSeed(id: string) {
  return {
    id,
    draftKey: `inst:${id}`,
    name: `Video ${id}`,
    context,
    state: 'draft' as const,
    clipCount: 1,
    durationMs: 1000,
    hasCaptions: false,
    poster: null,
    createdVia: 'host' as const,
    createdAt: 1,
    updatedAt: 1,
  };
}
