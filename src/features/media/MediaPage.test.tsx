import type { DraftSummary, PulseClient } from '@mieweb/pulse-embed';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Ticket } from '../../lib/api';
import { RouterProvider } from '../../ui/router';
import { PULSE_EMBED_OFF, PulseEmbedContext, type PulseEmbed } from '../pulse-embed/usePulseEmbed';
import { MediaPage, UNDO_MS } from './MediaPage';
import { PLACES, draftAt, uploadType } from './testRows';

// ── Seams: the toast region, the server, the signed-in person ────────────────

const toasts = vi.hoisted(() => ({
  toast: vi.fn(
    (_options: { message: string; action?: { label: string; onClick: () => void } }) => 'id',
  ),
}));
vi.mock('@mieweb/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@mieweb/ui')>()),
  useOptionalToast: () => toasts,
}));

const server = vi.hoisted(() => ({
  list: vi.fn(async () => ({ uploads: [] as unknown[] })),
  retarget: vi.fn(async () => ({ state: 'delivered', note: '' })),
  cancel: vi.fn(async () => ({ state: 'canceled' })),
  search: vi.fn(),
  media: vi.fn(async () => [] as unknown[]),
}));
vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return {
    ...actual,
    pulseUploadApi: {
      ...actual.pulseUploadApi,
      list: server.list,
      retarget: server.retarget,
      cancel: server.cancel,
    },
    ticketApi: { ...actual.ticketApi, search: server.search },
    mediaApi: { ...actual.mediaApi, list: server.media },
  };
});

vi.mock('../../lib/useSession', () => ({ useSession: () => ({ user: { id: 'me' } }) }));

// jsdom has no matchMedia, which the filters' SegmentedSwitcher reads.
window.matchMedia ??= (query: string) =>
  ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }) as MediaQueryList;

// ── A Pulse whose drafts the test sets ────────────────────────────────────────

function stubPulse(initial: DraftSummary[]) {
  let drafts = initial;
  const listeners = new Set<() => void>();
  const client = {
    listDrafts: vi.fn(async () => drafts),
    on: vi.fn((_event: string, cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }),
    upload: vi.fn(async () => ({ clientKey: 'k', draftKey: 'dk', sentAt: 1 })),
    cancelUpload: vi.fn(async () => {}),
    deleteDraft: vi.fn(async () => {}),
    renameDraft: vi.fn(async () => {}),
    setDraftContext: vi.fn(async () => {}),
    dismissReceipt: vi.fn(async () => {}),
    resumeOutbox: vi.fn(async () => {}),
  };
  /** Pulse's list changed (draftsChanged). */
  const set = async (next: DraftSummary[]) => {
    drafts = next;
    await act(async () => {
      listeners.forEach((cb) => cb());
    });
  };
  return { client, set };
}

function renderPage(client: Partial<PulseClient>) {
  const embed: PulseEmbed = {
    ...PULSE_EMBED_OFF,
    status: 'ready',
    client: client as PulseClient,
    teams: { t1: { pulseInApp: true, pulseClockInOut: false, pulseSharedDevice: false } },
    types: [uploadType('ticket.video'), uploadType('library.video'), uploadType('clock.session')],
    surfacesVisible: true,
    open: vi.fn(async () => null),
    reportError: vi.fn(),
  };
  window.history.replaceState(null, '', '/app/media');
  const view = render(
    <RouterProvider>
      <PulseEmbedContext.Provider value={embed}>
        <MediaPage />
      </PulseEmbedContext.Provider>
    </RouterProvider>,
  );
  return { ...view, embed };
}

const rowNames = () =>
  screen
    .getAllByRole('listitem')
    .filter((li) => li.classList.contains('unsent-video-row'))
    .map((li) => within(li).getAllByText(/^Video /)[0].textContent);

const lastToast = () => toasts.toast.mock.calls.at(-1)![0];

const menu = (name: string, item: string) => {
  fireEvent.click(screen.getByRole('button', { name: `More for ${name}` }));
  fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(item) }));
};

describe('MediaPage', () => {
  beforeEach(() => {
    toasts.toast.mockClear();
    Object.values(server).forEach((fn) => fn.mockClear());
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  it('Delete hides the row with Undo for about 5 s, then deletes', async () => {
    const d = draftAt(PLACES.ticket, 'ready', { id: 'a' });
    const { client } = stubPulse([d]);
    renderPage(client);
    await screen.findByRole('button', { name: 'Open Video a' });

    vi.useFakeTimers();
    menu('Video a', 'Delete');
    expect(screen.queryByRole('button', { name: 'Open Video a' })).toBeNull();
    expect(lastToast()).toMatchObject({
      message: 'Deleted Video a',
      duration: UNDO_MS,
      action: { label: 'Undo' },
    });
    expect(client.deleteDraft).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(UNDO_MS);
    });
    expect(client.deleteDraft).toHaveBeenCalledWith('a');
  });

  it('Undo brings a deleted row back in its place, and nothing is deleted', async () => {
    const drafts = [
      draftAt(PLACES.ticket, 'ready', { id: 'a', createdAt: 3 }),
      draftAt(PLACES.ticket, 'ready', { id: 'b', createdAt: 2 }),
      draftAt(PLACES.ticket, 'ready', { id: 'c', createdAt: 1 }),
    ];
    const { client } = stubPulse(drafts);
    renderPage(client);
    await screen.findByRole('button', { name: 'Open Video b' });

    vi.useFakeTimers();
    menu('Video b', 'Delete');
    expect(rowNames()).toEqual(['Video a', 'Video c']);
    act(() => lastToast().action!.onClick());
    expect(rowNames()).toEqual(['Video a', 'Video b', 'Video c']);
    await act(async () => {
      vi.advanceTimersByTime(UNDO_MS * 2);
    });
    expect(client.deleteDraft).not.toHaveBeenCalled();
  });

  it('a delete still waiting out its undo commits when the page is left', async () => {
    const { client } = stubPulse([draftAt(PLACES.ticket, 'ready', { id: 'a' })]);
    const { unmount } = renderPage(client);
    await screen.findByRole('button', { name: 'Open Video a' });
    menu('Video a', 'Delete');
    unmount();
    await act(async () => {});
    expect(client.deleteDraft).toHaveBeenCalledWith('a');
  });

  it('Send from the list starts at once; Undo cancels it', async () => {
    const { client } = stubPulse([draftAt(PLACES.ticket, 'ready', { id: 'a' })]);
    renderPage(client);
    await screen.findByRole('button', { name: 'Open Video a' });
    fireEvent.click(screen.getByRole('button', { name: 'More for Video a' }));
    const send = screen.getByRole('menuitem', { name: /Send/ });
    await act(async () => fireEvent.click(send));
    expect(client.upload).toHaveBeenCalledWith('a');
    expect(lastToast()).toMatchObject({ message: 'Sending…', action: { label: 'Undo' } });
    await act(async () => lastToast().action!.onClick());
    expect(client.cancelUpload).toHaveBeenCalledWith('a');
  });

  it("a row keeps its place when it retires, though its receipt's time is newer", async () => {
    const at = (id: string, createdAt: number) =>
      draftAt(PLACES.ticket, 'uploading', { id, createdAt });
    const { client, set } = stubPulse([at('a', 3), at('b', 2), at('c', 1)]);
    renderPage(client);
    await screen.findByRole('button', { name: 'Open Video b' });
    expect(rowNames()).toEqual(['Video a', 'Video b', 'Video c']);

    const retired = draftAt(PLACES.ticket, 'sent', {
      id: 'b',
      createdAt: 99,
      sent: {
        outcome: 'done',
        uploadId: 'u',
        artifactId: 'art',
        sentAt: 1,
        at: 2,
        expiresAt: 3,
        dismissed: false,
      },
    });
    await set([at('a', 3), retired, at('c', 1), at('new', 50)]);
    // The retired row stays second; a new video goes on top.
    expect(rowNames()).toEqual(['Video new', 'Video a', 'Video b', 'Video c']);
    expect(screen.getByText('Attached ✓')).toBeTruthy();
  });

  it('a kept video moves on the server, then its receipt is dismissed', async () => {
    const ticket: Ticket = {
      id: 'e'.repeat(24),
      teamId: 't1',
      title: 'Login fails on Safari',
      description: null,
      github: '',
      linkIsIssue: null,
      status: 'open',
      priority: null,
      createdBy: 'me',
      assignedTo: [],
      reviewedBy: null,
      reviewedAt: null,
      createdAt: '2026-11-19T00:00:00.000Z',
      updatedAt: null,
      linkedIssue: { source: 'redmine', id: '233' },
    };
    server.search.mockResolvedValue({ kind: 'text', tickets: [ticket] });
    const kept = draftAt(PLACES.ticket, 'sent', {
      id: 'k',
      sent: {
        outcome: 'kept',
        reason: 'ticket was deleted',
        uploadId: 'up1',
        artifactId: 'art1',
        sentAt: 1,
        at: 2,
        expiresAt: 3,
        dismissed: false,
      },
    });
    const { client } = stubPulse([kept]);
    renderPage(client);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Video k' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move to…' }));
    // A kept video is in the library already: My library isn't offered.
    expect(screen.queryByRole('button', { name: 'My library' })).toBeNull();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tickets' }), {
      target: { value: 'safari' },
    });
    const target = await screen.findByRole('button', { name: 'Login fails on Safari' });
    await act(async () => fireEvent.click(target));

    expect(server.retarget).toHaveBeenCalledWith({
      uploadId: 'up1',
      type: 'ticket.video',
      target: { kind: 'ticket', id: ticket.id },
    });
    expect(client.dismissReceipt).toHaveBeenCalledWith('k');
    expect(server.retarget.mock.invocationCallOrder[0]).toBeLessThan(
      client.dismissReceipt.mock.invocationCallOrder[0],
    );
    expect(client.setDraftContext).not.toHaveBeenCalled();
  });

  it('a clock video deleted after its clock action tells the server it is not coming', async () => {
    const bound = draftAt(PLACES.wrapup, 'ready', { id: 'w', confirmedAt: 5 });
    server.list.mockResolvedValue({
      uploads: [
        {
          id: 'intent1',
          userId: 'me',
          type: 'clock.wrapup',
          targetKey: PLACES.wrapup.context.key,
          state: 'intent',
          name: null,
          durationMs: null,
          sentAt: null,
          updatedAt: null,
          reason: null,
          note: null,
          attachmentId: null,
          mediaId: null,
          clientKey: null,
          draftKey: bound.draftKey,
        },
      ],
    });
    const { client } = stubPulse([bound]);
    const { unmount } = renderPage(client);
    await screen.findByRole('button', { name: 'Open Video w' });
    await act(async () => {});
    menu('Video w', 'Delete');
    unmount();
    await act(async () => {});
    expect(client.deleteDraft).toHaveBeenCalledWith('w');
    expect(server.cancel).toHaveBeenCalledWith({ uploadId: 'intent1', reason: 'deleted' });
    server.list.mockResolvedValue({ uploads: [] });
  });

  it('offline, the section renders from this phone alone and says so', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const { client } = stubPulse([draftAt(PLACES.ticket, 'waiting_network', { id: 'a' })]);
    renderPage(client);
    await screen.findByRole('button', { name: 'Open Video a' });
    expect(screen.getByText('Offline: showing videos on this phone')).toBeTruthy();
    expect(server.list).not.toHaveBeenCalled();
  });
});
