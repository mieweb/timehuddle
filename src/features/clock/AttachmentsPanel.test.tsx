import type { FlowResult, PulseClient, PulseInfo } from '@mieweb/pulse-embed';
import { createFakePulse, type FakePulseHandle } from '@mieweb/pulse-embed/testing';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Attachment, PulseUploadPublic } from '@lib/api';
import { PRE_PROMPT_SEEN_KEY } from '../pulse-embed/PermissionPrePrompt';
import { PULSE_EMBED_OFF, PulseEmbedContext, type PulseEmbed } from '../pulse-embed/usePulseEmbed';
import { AttachmentsPanel } from './AttachmentsPanel';

const VIDEO = '0b7e7c1e-5a3f-4c1d-9e2a-6f1d2c3b4a59';

/** One video attached twice: once by path, once by the backend's full URL. */
const row = (id: string, url: string): Attachment => ({
  id,
  url,
  type: 'video',
  title: null,
  attachedTo: { kind: 'ticket', id: 't1' },
  addedBy: 'u1',
  addedAt: '2026-10-31T12:00:00.000Z',
  name: 'Standup',
  canRename: true,
});

const listAttachments = vi.hoisted(() => vi.fn());
// The server's Pulse uploads for the place (pulseUploads.list).
const listUploads = vi.hoisted(() => vi.fn());
vi.mock('@lib/api', () => ({
  resolveMediaUrl: (path: string) => path,
  METEOR_BASE_URL: 'http://localhost:3100',
  METEOR_API_BASE: 'http://localhost:3100',
  attachmentApi: {
    list: listAttachments,
    remove: () => Promise.resolve(),
  },
  videoApi: { rename: (_video: string, name: string) => Promise.resolve(name.trim() || null) },
  pulseUploadApi: { list: listUploads },
}));
// The live publication: the docs it holds now, and a way to say they changed.
const ddp = vi.hoisted(() => ({
  docs: [] as Record<string, unknown>[],
  changed: () => {},
  subscribed: [] as unknown[][],
}));
vi.mock('../../lib/ddp', () => ({
  getDdpClient: () => ({
    docs: () => ddp.docs,
    onCollectionChange: (_collection: string, cb: () => void) => {
      ddp.changed = cb;
      return () => {};
    },
    subscribe: (...args: unknown[]) => {
      ddp.subscribed.push(args);
      return () => {};
    },
    onReconnect: () => () => {},
  }),
}));
// Inside the app, where Pulse can run (it does only with the provider ready).
vi.mock('../../lib/device', () => ({ isNativeApp: () => true, isMobileBrowser: () => false }));
// The buttons: "pick" hands the panel a file, as Upload's file picker does.
const picked = vi.hoisted(() => ({ files: [] as File[] }));
vi.mock('../pulse-upload/PulseButton', () => ({
  PulseControls: ({ onFiles }: { onFiles?: (files: File[]) => void }) => (
    <button type="button" onClick={() => onFiles?.(picked.files)}>
      pick
    </button>
  ),
}));
vi.mock('../pulse-upload/usePulseUpload', () => ({ usePulseUpload: () => ({}) }));
// Each file's upload, settled by the test.
const uploads = vi.hoisted(
  () =>
    [] as {
      onProgress: (fraction: number) => void;
      signal: AbortSignal;
      resolve: (videoid: string) => void;
      reject: (error: Error) => void;
    }[],
);
vi.mock('../pulse-upload/videoFile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pulse-upload/videoFile')>()),
  uploadVideoTo: (
    _destination: unknown,
    _file: File,
    onProgress: (fraction: number) => void,
    signal: AbortSignal,
  ) =>
    new Promise<string>((resolve, reject) => uploads.push({ onProgress, signal, resolve, reject })),
}));

const rows = () => [
  row('a1', `/pulsevault/artifacts/${VIDEO}`),
  row('a2', `http://localhost:3100/pulsevault/artifacts/${VIDEO}`),
];

async function renderPanel() {
  await act(async () => {
    render(<AttachmentsPanel kind="ticket" entityId="t1" currentUserId="u1" />);
  });
}

async function pickDemo() {
  picked.files = [new File(['x'], 'demo.mov', { type: 'video/quicktime' })];
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'pick' })));
}

describe('AttachmentsPanel', () => {
  beforeEach(() => {
    listAttachments.mockReset();
    listAttachments.mockResolvedValue(rows());
    listUploads.mockReset();
    listUploads.mockResolvedValue({ uploads: [] });
  });
  afterEach(() => {
    cleanup();
    uploads.length = 0;
  });

  it('uploads a picked video in place, with its progress, and cancels it', async () => {
    await renderPanel();
    await pickDemo();
    act(() => uploads[0].onProgress(0.42));
    expect(
      screen.getByRole('progressbar', { name: 'Uploading demo.mov' }).getAttribute('aria-valuenow'),
    ).toBe('42');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel upload of demo.mov' }));
    expect(uploads[0].signal.aborted).toBe(true);
    expect(screen.queryByRole('progressbar', { name: 'Uploading demo.mov' })).toBeNull();
  });

  it('says Processing once its bytes are in, keeps looking for its card, then says it is not showing', async () => {
    const LANDED = '7d4e1c2a-9b3f-4e5d-8a6b-1c2d3e4f5a6b';
    await renderPanel();
    await pickDemo();
    act(() => uploads[0].onProgress(1));
    expect(screen.getByText('Processing…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel upload of demo.mov' })).toBeNull();
    vi.useFakeTimers();
    try {
      // Landed, and the list fetched again still without it: still Processing.
      await act(async () => uploads[0].resolve(LANDED));
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(listAttachments).toHaveBeenCalledTimes(2);
      expect(screen.getByText('Processing…')).toBeTruthy();
      // Looked for again a few times; never listed, so the card says so
      // instead of staying on Processing with nothing to press.
      for (const wait of [2_000, 5_000, 10_000, 20_000, 0]) {
        await act(() => vi.advanceTimersByTimeAsync(wait));
      }
      expect(listAttachments).toHaveBeenCalledTimes(6);
      expect(screen.queryByText('Processing…')).toBeNull();
      expect(screen.getByText(/demo\.mov uploaded, but isn't showing yet/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('turns away a file that is not a video, saying why', async () => {
    await renderPanel();
    picked.files = [new File(['x'], 'notes.pdf', { type: 'application/pdf' })];
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'pick' })));
    expect(uploads).toHaveLength(0);
    expect(screen.getByText(/notes\.pdf: That file isn't a video\./)).toBeTruthy();
  });

  it('says why a video did not upload, and sends it again on Retry', async () => {
    await renderPanel();
    await pickDemo();
    await act(async () => uploads[0].reject(new Error('The server said no.')));
    expect(screen.getByText("demo.mov didn't upload")).toBeTruthy();
    expect(screen.getByText('The server said no.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry demo.mov' }));
    expect(uploads).toHaveLength(2);
  });

  it('uploads several picked videos at once, each on its own card', async () => {
    await renderPanel();
    picked.files = [
      new File(['x'], 'one.mov', { type: 'video/quicktime' }),
      new File(['x'], 'two.mov', { type: 'video/quicktime' }),
    ];
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'pick' })));
    expect(uploads).toHaveLength(2);
    expect(screen.getByRole('progressbar', { name: 'Uploading one.mov' })).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Uploading two.mov' })).toBeTruthy();
  });

  it("renames every card of a video, however each row's URL was stored", async () => {
    await renderPanel();
    expect(screen.getAllByRole('button', { name: 'Play Standup' })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'More for Standup' })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Video name' }), {
      target: { value: 'Morning standup' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    expect(screen.getAllByRole('button', { name: 'Play Morning standup' })).toHaveLength(2);
  });
});

// ─── Pulse in the app ─────────────────────────────────────────────────────────

const TICKET = '64b7f00d64b7f00d64b7f00d';
const KEY = `ticket:${TICKET}`;
const DRAFT_KEY = 'inst-1:d1';
const LANDED_VIDEO = '7d4e1c2a-9b3f-4e5d-8a6b-1c2d3e4f5a6b';

/** The server's row for the draft's upload. */
const serverRow = (state: PulseUploadPublic['state'], over: Partial<PulseUploadPublic> = {}) => ({
  id: 'up1',
  userId: 'u1',
  type: 'ticket.video' as const,
  targetKey: KEY,
  state,
  name: 'Fix login take',
  durationMs: 42_000,
  sentAt: '2026-11-19T10:00:00.000Z',
  updatedAt: '2026-11-19T10:00:00.000Z',
  reason: null,
  note: null,
  attachmentId: null,
  mediaId: null,
  ...over,
});

const landedAttachment: Attachment = {
  ...row('a3', `/pulsevault/artifacts/${LANDED_VIDEO}`),
  attachedTo: { kind: 'ticket', id: TICKET },
  name: 'Fix login take',
};

function pulseReady(client: PulseClient, over: Partial<PulseEmbed> = {}): PulseEmbed {
  return {
    ...PULSE_EMBED_OFF,
    status: 'ready',
    client,
    info: {
      contract: { major: 1, minor: 0 },
      platform: 'ios',
      supported: true,
      capabilities: [],
    } as unknown as PulseInfo,
    runtimePaused: false,
    teams: { team1: { pulseInApp: true, pulseClockInOut: false, pulseSharedDevice: false } },
    types: [{ id: 'ticket.video' } as NonNullable<PulseEmbed['types']>[number]],
    open: vi.fn(async () => null),
    ...over,
  };
}

const ticketPanel = (
  <AttachmentsPanel
    kind="ticket"
    entityId={TICKET}
    currentUserId="u1"
    place={{ type: 'ticket.video', ticketId: TICKET, label: 'Fix login' }}
    teamId="team1"
  />
);

describe('AttachmentsPanel with Pulse', () => {
  let fake: FakePulseHandle | null = null;
  beforeEach(() => {
    listAttachments.mockReset();
    listAttachments.mockResolvedValue(rows());
    listUploads.mockReset();
    listUploads.mockResolvedValue({ uploads: [] });
    ddp.docs = [];
    ddp.subscribed = [];
    localStorage.setItem(PRE_PROMPT_SEEN_KEY, '1');
  });
  afterEach(() => {
    cleanup();
    fake?.dispose();
    fake = null;
    localStorage.clear();
  });

  const uploadingDraft = () =>
    createFakePulse({
      drafts: [
        {
          id: 'd1',
          draftKey: DRAFT_KEY,
          name: 'Fix login take',
          state: 'uploading',
          context: { key: KEY, kind: 'ticket', id: TICKET, label: 'Fix login' },
          upload: { clientKey: `${DRAFT_KEY}:0123456789abcdef`, uploadId: 'up1', progress: 0.4 },
        } as never,
      ],
    });

  it('with every Pulse setting off it is the panel it was: the link, no rows', async () => {
    await act(async () => {
      render(
        <PulseEmbedContext.Provider value={PULSE_EMBED_OFF}>
          {ticketPanel}
        </PulseEmbedContext.Provider>,
      );
    });
    // Today's Pulse and Upload buttons (PulseControls), the list, nothing else.
    expect(screen.getByRole('button', { name: 'pick' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record with Pulse' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Videos on this phone' })).toBeNull();
    expect(screen.queryByText(/unsent video/)).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Play Standup' })).toHaveLength(2);
  });

  it('reads no Pulse uploads for a panel with no Pulse place', async () => {
    await renderPanel();
    expect(listUploads).not.toHaveBeenCalled();
    expect(ddp.subscribed).toEqual([]);
  });

  it("shows this phone's video on its way as a row, merged with the server's by draftKey", async () => {
    fake = uploadingDraft();
    listUploads.mockResolvedValue({
      uploads: [serverRow('uploading', { draftKey: DRAFT_KEY, clientKey: 'k' })],
    });
    await act(async () => {
      render(
        <PulseEmbedContext.Provider value={pulseReady(fake!.client)}>
          {ticketPanel}
        </PulseEmbedContext.Provider>,
      );
    });
    const phone = await screen.findByRole('list', { name: 'Videos on this phone' });
    // One row for the video, not one for the draft and one for the server's row.
    expect(within(phone).getAllByRole('listitem')).toHaveLength(1);
    expect(within(phone).getByText('Uploading 40%')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'On this phone' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Record with Pulse' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'pick' })).toBeNull();
    expect(listUploads).toHaveBeenCalledWith({ targetKey: KEY });
  });

  it('replaces the row in place with the video once it lands, and fetches the list again', async () => {
    fake = uploadingDraft();
    listUploads.mockResolvedValue({
      uploads: [serverRow('uploading', { draftKey: DRAFT_KEY, clientKey: 'k' })],
    });
    ddp.docs = [{ _id: 'up1', userId: 'u1', targetKey: KEY, state: 'uploading' }];
    await act(async () => {
      render(
        <PulseEmbedContext.Provider value={pulseReady(fake!.client)}>
          {ticketPanel}
        </PulseEmbedContext.Provider>,
      );
    });
    const phone = await screen.findByRole('list', { name: 'Videos on this phone' });
    await within(phone).findByText('Uploading 40%');
    expect(listAttachments).toHaveBeenCalledTimes(1);

    // It lands: the publication lets it go, the server's row is delivered,
    // and the ticket's list has its attachment.
    listUploads.mockResolvedValue({
      uploads: [serverRow('delivered', { draftKey: DRAFT_KEY, attachmentId: 'a3' })],
    });
    listAttachments.mockResolvedValue([...rows(), landedAttachment]);
    ddp.docs = [];
    await act(async () => ddp.changed());

    // The same slot now holds the video's card; the list doesn't show it twice.
    const slot = await within(phone).findByRole('button', { name: 'Play Fix login take' });
    expect(within(phone).getAllByRole('listitem')).toHaveLength(1);
    expect(slot.closest('li')?.classList.contains('landed')).toBe(true);
    const list = screen.getByRole('list', { name: 'Videos' });
    expect(within(list).queryByRole('button', { name: 'Play Fix login take' })).toBeNull();
    expect(within(list).getAllByRole('button', { name: 'Play Standup' })).toHaveLength(2);
    // Fetched again when it landed (once for leaving the live list, once more
    // for its delivered row is fine; never not at all).
    expect(listAttachments.mock.calls.length).toBeGreaterThanOrEqual(2);
    // Every row has landed: no "On this phone" heading over the card.
    expect(screen.queryByRole('heading', { name: 'On this phone' })).toBeNull();
  });

  it("moves focus on to the new row once Pulse's flow ends", async () => {
    fake = uploadingDraft();
    const sent = {
      requestId: 'r1',
      entry: 'record',
      endedOn: 'export',
      stage: 'exported',
      context: null,
      endedAt: 2,
      status: 'completed',
      mode: 'pulse',
      draftId: 'd1',
      sentAt: 1,
      clientKey: `${DRAFT_KEY}:0123456789abcdef`,
      draftKey: DRAFT_KEY,
    } as FlowResult;
    const embed = pulseReady(fake.client, { open: vi.fn(async () => sent) });
    await act(async () => {
      render(<PulseEmbedContext.Provider value={embed}>{ticketPanel}</PulseEmbedContext.Provider>);
    });
    await screen.findByRole('list', { name: 'Videos on this phone' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Record with Pulse' }));
    });
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Open Fix login take' }),
    );
  });

  it("opens a row's draft in Pulse's editor", async () => {
    fake = uploadingDraft();
    const embed = pulseReady(fake.client);
    await act(async () => {
      render(<PulseEmbedContext.Provider value={embed}>{ticketPanel}</PulseEmbedContext.Provider>);
    });
    const open = await screen.findByRole('button', { name: 'Open Fix login take' });
    await act(async () => {
      fireEvent.click(open);
    });
    expect(embed.open).toHaveBeenCalledWith({ entry: 'edit', draftId: 'd1' });
  });

  it("shows another device's video on its way, without Pulse here (a computer)", async () => {
    listUploads.mockResolvedValue({ uploads: [] });
    ddp.docs = [{ _id: 'up9', userId: 'them', targetKey: KEY, state: 'uploading' }];
    await act(async () => {
      render(ticketPanel);
    });
    const phone = await screen.findByRole('list', { name: 'Videos on this phone' });
    expect(within(phone).getByText('Uploading from iPhone…')).toBeTruthy();
    // Not "On this phone": it isn't on this one.
    expect(screen.queryByRole('heading', { name: 'On this phone' })).toBeNull();
    // Nothing to open from here.
    expect(within(phone).queryByRole('button')).toBeNull();
  });
});
