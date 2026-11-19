import type { FlowResult, PulseClient, PulseContext, PulseInfo } from '@mieweb/pulse-embed';
import { createFakePulse, type FakePulseHandle } from '@mieweb/pulse-embed/testing';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PulseTeamSettings, PulseUploadTypeInfo } from '../../lib/api';
import { PRE_PROMPT_SEEN_KEY, resetPrePromptForTests } from './PermissionPrePrompt';
import prePromptSource from './PermissionPrePrompt.tsx?raw';
import { PulseRecordButton, type PulseRecordButtonProps } from './PulseRecordButton';
import recordButtonSource from './PulseRecordButton.tsx?raw';
import { RECORD_TEXT } from './recordStrings';
import { PULSE_EMBED_OFF, PulseEmbedContext, type PulseEmbed } from './usePulseEmbed';

const device = vi.hoisted(() => ({ native: true, mobileBrowser: false }));
vi.mock('../../lib/device', () => ({
  isNativeApp: () => device.native,
  isMobileBrowser: () => device.mobileBrowser,
}));

const INFO = {
  sdkVersion: '2.8.0',
  build: '1',
  gitSha: 'abc',
  contract: { major: 1, minor: 0 },
  formatVersion: 2,
  dbSchema: 20,
  entries: ['record', 'edit', 'export'],
  methods: [],
  capabilities: [],
  platform: 'ios',
  osVersion: '18.0',
  supported: true,
  namespace: null,
} as unknown as PulseInfo;

const on: PulseTeamSettings = {
  pulseInApp: true,
  pulseClockInOut: false,
  pulseSharedDevice: false,
};
const off: PulseTeamSettings = { ...on, pulseInApp: false };

const type = (id: PulseUploadTypeInfo['id']): PulseUploadTypeInfo => ({
  id,
  version: 1,
  targetKind: 'ticket',
  title: 'Ticket',
  sendLabel: null,
  prompt: null,
  limits: null,
  requireName: false,
  clock: null,
  requireOnline: false,
  confirmSend: false,
  maxBytes: 500 * 1024 * 1024,
});

const sentResult = (context: PulseContext): FlowResult => ({
  requestId: 'r1',
  entry: 'record',
  endedOn: 'export',
  stage: 'exported',
  context,
  endedAt: 2,
  status: 'completed',
  mode: 'pulse',
  draftId: 'd1',
  sentAt: 1,
  clientKey: 'inst:d1:0123456789abcdef',
  draftKey: 'inst:d1',
});

/** Pulse ready in the app for team t1, with ticket and post videos offered. */
function readyEmbed(over: Partial<PulseEmbed> = {}): PulseEmbed {
  return {
    ...PULSE_EMBED_OFF,
    status: 'ready',
    client: {} as PulseClient,
    info: INFO,
    runtimePaused: false,
    teams: { t1: on },
    types: [type('ticket.video'), type('huddle.post')],
    open: vi.fn(async (request) =>
      request.entry === 'record' ? sentResult(request.context) : null,
    ),
    ...over,
  };
}

const FALLBACK = <button type="button">Today's Pulse link</button>;

const ticketPlace: PulseRecordButtonProps['place'] = {
  type: 'ticket.video',
  ticketId: 'abc123',
  label: 'Fix login',
};

function mount(embed: PulseEmbed | null, props: Partial<PulseRecordButtonProps> = {}) {
  const button = (
    <PulseRecordButton place={ticketPlace} teamId="t1" fallback={FALLBACK} {...props} />
  );
  return render(
    embed ? (
      <PulseEmbedContext.Provider value={embed}>{button}</PulseEmbedContext.Provider>
    ) : (
      button
    ),
  );
}

const glyph = () => screen.queryByRole('button', { name: RECORD_TEXT.record });
const fallbackShown = () => screen.queryByRole('button', { name: "Today's Pulse link" });

describe('PulseRecordButton', () => {
  beforeEach(() => {
    device.native = true;
    device.mobileBrowser = false;
    localStorage.clear();
    resetPrePromptForTests();
  });
  afterEach(cleanup);

  describe('link or Pulse in the app', () => {
    it('is exactly today’s link outside the provider (every setting off: nothing changes)', () => {
      const { container } = mount(null);
      expect(fallbackShown()).toBeTruthy();
      expect(glyph()).toBeNull();
      expect(container.innerHTML).toBe('<button type="button">Today\'s Pulse link</button>');
    });

    it('is today’s link while Pulse is still starting', () => {
      mount(readyEmbed({ status: 'starting', client: null }));
      expect(fallbackShown()).toBeTruthy();
      expect(glyph()).toBeNull();
    });

    it("is today's link when the team's Pulse in the app is off", () => {
      mount(readyEmbed({ teams: { t1: off } }));
      expect(fallbackShown()).toBeTruthy();
      expect(glyph()).toBeNull();
    });

    it('is today’s link before the server has sent the team settings', () => {
      mount(readyEmbed({ teams: null }));
      expect(fallbackShown()).toBeTruthy();
    });

    it('is today’s link when the server does not offer the type', () => {
      mount(readyEmbed({ types: [type('huddle.post')] }));
      expect(fallbackShown()).toBeTruthy();
    });

    it('is today’s link while Pulse is paused for everyone', () => {
      mount(readyEmbed({ runtimePaused: true }));
      expect(fallbackShown()).toBeTruthy();
    });

    it('is today’s link in a browser, even with Pulse ready', () => {
      device.native = false;
      mount(readyEmbed());
      expect(fallbackShown()).toBeTruthy();
      expect(glyph()).toBeNull();
    });

    it('is today’s link for a place that cannot be one (an id that breaks a key)', () => {
      mount(readyEmbed(), { place: { ...ticketPlace, ticketId: 'a:b' } as typeof ticketPlace });
      expect(fallbackShown()).toBeTruthy();
    });

    it('is the icon-only "Record with Pulse" glyph in the app, naming its place', () => {
      mount(readyEmbed());
      const button = glyph();
      expect(button).toBeTruthy();
      expect(button?.getAttribute('aria-label')).toBe('Record with Pulse');
      expect(button?.textContent).toBe('');
      expect(fallbackShown()).toBeNull();
      const described = document.getElementById(button?.getAttribute('aria-describedby') ?? '');
      expect(described?.textContent).toBe('For Fix login');
    });

    it("takes a post's team from the place itself", () => {
      mount(readyEmbed(), {
        place: { type: 'huddle.post', teamId: 't1', label: 'Platform' },
        teamId: undefined,
      });
      expect(glyph()).toBeTruthy();
    });
  });

  describe('recording', () => {
    it('explains first, then records the place on Continue and gives focus back', async () => {
      const embed = readyEmbed();
      const onResult = vi.fn();
      mount(embed, { onResult });

      fireEvent.click(glyph()!);
      expect(screen.getByText(RECORD_TEXT.prePrompt.body)).toBeTruthy();
      expect(embed.open).not.toHaveBeenCalled();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: RECORD_TEXT.prePrompt.continue }));
      });
      expect(embed.open).toHaveBeenCalledTimes(1);
      expect(embed.open).toHaveBeenCalledWith({
        entry: 'record',
        context: expect.objectContaining({
          key: 'ticket:abc123',
          kind: 'ticket',
          id: 'abc123',
          label: 'Fix login',
          uploadType: expect.objectContaining({ id: 'ticket.video' }),
          data: { type: 'ticket.video', target: { kind: 'ticket', id: 'abc123' } },
        }),
      });
      expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ draftKey: 'inst:d1' }));
      expect(document.activeElement).toBe(glyph());
      expect(localStorage.getItem(PRE_PROMPT_SEEN_KEY)).toBe('1');
    });

    it('records at once once the explanation was read on this phone', async () => {
      localStorage.setItem(PRE_PROMPT_SEEN_KEY, '1');
      const embed = readyEmbed();
      mount(embed);
      await act(async () => {
        fireEvent.click(glyph()!);
      });
      expect(screen.queryByText(RECORD_TEXT.prePrompt.body)).toBeNull();
      expect(embed.open).toHaveBeenCalledTimes(1);
    });

    it('gives focus back when Pulse could not open (null result)', async () => {
      localStorage.setItem(PRE_PROMPT_SEEN_KEY, '1');
      const onResult = vi.fn();
      mount(readyEmbed({ open: vi.fn(async () => null) }), { onResult });
      await act(async () => {
        fireEvent.click(glyph()!);
      });
      expect(document.activeElement).toBe(glyph());
      expect(onResult).not.toHaveBeenCalled();
    });

    it('ignores a second tap while the flow is open', async () => {
      localStorage.setItem(PRE_PROMPT_SEEN_KEY, '1');
      let finish: (r: FlowResult | null) => void = () => {};
      const open = vi.fn(() => new Promise<FlowResult | null>((resolve) => (finish = resolve)));
      mount(readyEmbed({ open }));
      fireEvent.click(glyph()!);
      fireEvent.click(glyph()!);
      expect(open).toHaveBeenCalledTimes(1);
      expect(glyph()?.getAttribute('aria-busy')).toBe('true');
      await act(async () => finish(null));
      expect(glyph()?.getAttribute('aria-busy')).toBeNull();
    });
  });

  describe('"1 unsent video here · Open"', () => {
    let fake: FakePulseHandle;
    const draftFor = (
      id: string,
      key: string,
      state: 'draft' | 'ready' | 'uploading',
      at: number,
    ) =>
      ({
        id,
        name: `Take ${id}`,
        state,
        context: { key, kind: key.split(':')[0], id: key.split(':')[1], label: 'Fix login' },
        createdAt: at,
        updatedAt: at,
      }) as never;

    afterEach(() => fake?.dispose());

    it('counts the place’s unsent videos and opens the newest in the editor', async () => {
      fake = createFakePulse({
        drafts: [
          draftFor('d1', 'ticket:abc123', 'draft', 1),
          draftFor('d2', 'ticket:abc123', 'ready', 5),
          // On its way: not "unsent here".
          draftFor('d3', 'ticket:abc123', 'uploading', 9),
          // Another ticket's.
          draftFor('d4', 'ticket:other', 'draft', 9),
        ],
      });
      const embed = readyEmbed({ client: fake.client, open: vi.fn(async () => null) });
      mount(embed, { showUnsent: true });

      const link = await screen.findByRole('button', { name: RECORD_TEXT.unsentHere(2) });
      expect(link.textContent).toBe('2 unsent videos here · Open');
      await act(async () => {
        fireEvent.click(link);
      });
      expect(embed.open).toHaveBeenCalledWith({ entry: 'edit', draftId: 'd2' });
    });

    it('says nothing when the place has none', async () => {
      fake = createFakePulse({ drafts: [draftFor('d4', 'ticket:other', 'draft', 1)] });
      mount(readyEmbed({ client: fake.client }), { showUnsent: true });
      await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
      expect(screen.queryByText(/unsent video/)).toBeNull();
    });

    it('says "1 unsent video here · Open" for one', async () => {
      fake = createFakePulse({ drafts: [draftFor('d1', 'ticket:abc123', 'draft', 1)] });
      mount(readyEmbed({ client: fake.client }), { showUnsent: true });
      expect(await screen.findByText('1 unsent video here · Open')).toBeTruthy();
    });
  });
});

describe('record strings', () => {
  it.each([
    ['PulseRecordButton.tsx', recordButtonSource],
    ['PermissionPrePrompt.tsx', prePromptSource],
  ])('%s has no English of its own: every word is from recordStrings.ts', (_file, text) => {
    const code = text
      // Comments say what the code does; they are not shown.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    // Text between JSX tags.
    const jsxText = [...code.matchAll(/>\s*([^<>{}\n]*[A-Za-z][^<>{}\n]*)\s*</g)].map((m) =>
      m[1].trim(),
    );
    expect(jsxText.filter((text) => !/^[\w.]+\s*=>/.test(text))).toEqual([]);
    // Words in the attributes people hear or read.
    const attrs = [
      ...code.matchAll(/(?:aria-label|title|placeholder|alt)=["']([^"']*[A-Za-z][^"']*)["']/g),
    ].map((m) => m[1]);
    expect(attrs).toEqual([]);
  });

  it('the pre-prompt says recordStrings.ts’s words, naming tickets and clock sessions', async () => {
    const { PermissionPrePrompt } = await import('./PermissionPrePrompt');
    render(<PermissionPrePrompt open onContinue={() => {}} onNotNow={() => {}} />);
    expect(screen.getByText(RECORD_TEXT.prePrompt.title)).toBeTruthy();
    expect(screen.getByText(RECORD_TEXT.prePrompt.body)).toBeTruthy();
    expect(screen.getByText(RECORD_TEXT.prePrompt.detail)).toBeTruthy();
    expect(RECORD_TEXT.prePrompt.body).toMatch(/tickets/);
    expect(RECORD_TEXT.prePrompt.body).toMatch(/clock sessions/);
    expect(RECORD_TEXT.prePrompt.body).toMatch(/camera/);
    expect(RECORD_TEXT.prePrompt.body).toMatch(/microphone/);
    cleanup();
  });
});
