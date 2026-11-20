import type { DraftState, DraftSummary } from '@mieweb/pulse-embed';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { pulseUploadApi, type PulseUploadPublic, type PulseUploadState } from '../../lib/api';
import { getDdpClient } from '../../lib/ddp';
import {
  isMoving,
  leftPublication,
  mergeRows,
  mergeServerRows,
  newlyDelivered,
  uploadFromDoc,
} from './mergeRows';
import { useLiveUploads } from './useLiveUploads';

const draft = (id: string, state: DraftState, extra: Partial<DraftSummary> = {}): DraftSummary => ({
  id,
  draftKey: `inst:${id}`,
  name: `Video ${id}`,
  context: null,
  state,
  clipCount: 1,
  durationMs: 42_000,
  hasCaptions: false,
  poster: { rel: `drafts/${id}/poster.jpg`, path: `/p/${id}.jpg`, webUrl: `local://${id}.jpg` },
  createdVia: 'host',
  createdAt: 1_000,
  updatedAt: 1_000,
  ...extra,
});

const server = (
  id: string,
  state: PulseUploadState,
  extra: Partial<PulseUploadPublic> = {},
): PulseUploadPublic => ({
  id,
  userId: 'me',
  type: 'ticket.video',
  targetKey: 'ticket:abc',
  state,
  name: `Server ${id}`,
  durationMs: 40_000,
  sentAt: '2026-11-19T10:00:00.000Z',
  updatedAt: '2026-11-19T10:00:00.000Z',
  reason: null,
  note: null,
  attachmentId: null,
  mediaId: null,
  ...extra,
});

describe('mergeRows', () => {
  it('makes one row per video, joined by draftKey', () => {
    const rows = mergeRows(
      [draft('d1', 'uploading')],
      [server('u1', 'uploading', { draftKey: 'inst:d1' })],
      { userId: 'me' },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: 'inst:d1',
      draftKey: 'inst:d1',
      name: 'Video d1',
      landed: false,
      mine: true,
    });
    expect(rows[0].local?.id).toBe('d1');
    expect(rows[0].server?.id).toBe('u1');
  });

  it('keeps the slot (same key) and the local poster when the server delivers', () => {
    const before = mergeRows([draft('d1', 'delivering')], [], { userId: 'me' });
    const after = mergeRows(
      [draft('d1', 'delivering')],
      [server('u1', 'delivered', { draftKey: 'inst:d1', attachmentId: 'att1' })],
      { userId: 'me' },
    );
    expect(after[0].key).toBe(before[0].key);
    expect(after[0].landed).toBe(true);
    expect(after[0].server?.attachmentId).toBe('att1');
    // The server's poster may not have loaded yet: this phone's stays available.
    expect(after[0].localPoster).toBe('local://d1.jpg');
  });

  it('keeps the slot once the draft retires into a server-only row', () => {
    const local = mergeRows(
      [draft('d1', 'delivering')],
      [server('u1', 'processing', { draftKey: 'inst:d1' })],
    );
    const serverOnly = mergeRows([], [server('u1', 'delivered', { draftKey: 'inst:d1' })]);
    expect(serverOnly[0].key).toBe(local[0].key);
    expect(serverOnly[0].landed).toBe(true);
  });

  it('joins a live row without keys to the draft whose job holds its upload id', () => {
    const rows = mergeRows(
      [
        draft('d1', 'uploading', {
          upload: { clientKey: 'inst:d1:aa', uploadId: 'u1', attempts: 1, sentAt: 5 },
        }),
      ],
      [server('u1', 'uploading')],
      { userId: 'me' },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].server?.id).toBe('u1');
  });

  it('shows the newest server row of a resent video, never two rows', () => {
    const rows = mergeRows(
      [draft('d1', 'uploading')],
      [
        server('old', 'canceled', { draftKey: 'inst:d1', updatedAt: '2026-11-19T10:00:00.000Z' }),
        server('new', 'uploading', { draftKey: 'inst:d1', updatedAt: '2026-11-19T10:05:00.000Z' }),
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].server?.id).toBe('new');
  });

  it("adds others' videos on their way as their own rows", () => {
    const rows = mergeRows(
      [draft('d1', 'ready')],
      [server('theirs', 'uploading', { userId: 'them', sentAt: '2026-11-19T11:00:00.000Z' })],
      { userId: 'me' },
    );
    expect(rows.map((r) => r.key)).toEqual(['upload:theirs', 'inst:d1']);
    expect(rows[0]).toMatchObject({ mine: false, local: null, localPoster: null });
  });

  it('leaves out server rows that ended without a video', () => {
    const rows = mergeRows(
      [],
      ['canceled', 'failed', 'abandoned'].map((s, i) => server(`u${i}`, s as PulseUploadState)),
    );
    expect(rows).toEqual([]);
  });

  it('drops a canceled server row of a draft back to Draft, keeping the draft', () => {
    const rows = mergeRows(
      [draft('d1', 'draft')],
      [server('u1', 'canceled', { draftKey: 'inst:d1' })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].server).toBeNull();
  });

  it('orders newest first', () => {
    const rows = mergeRows(
      [draft('old', 'draft', { createdAt: 1 }), draft('new', 'draft', { createdAt: 2 })],
      [],
    );
    expect(rows.map((r) => r.local?.id)).toEqual(['new', 'old']);
  });
});

describe('mergeServerRows', () => {
  it('takes the live state, and the keys from the list', () => {
    const listed = server('u1', 'reserved', {
      draftKey: 'inst:d1',
      clientKey: 'inst:d1:aa',
      updatedAt: '2026-11-19T10:00:00.000Z',
    });
    const live = server('u1', 'processing', { updatedAt: '2026-11-19T10:01:00.000Z' });
    expect(mergeServerRows([listed], [live])).toEqual([
      { ...live, draftKey: 'inst:d1', clientKey: 'inst:d1:aa' },
    ]);
  });

  it('keeps the listed row when it is newer than the live copy', () => {
    const listed = server('u1', 'delivered', { updatedAt: '2026-11-19T10:02:00.000Z' });
    const live = server('u1', 'processing', { updatedAt: '2026-11-19T10:01:00.000Z' });
    expect(mergeServerRows([listed], [live])).toEqual([listed]);
  });

  it("adds live rows the list doesn't have (someone else's)", () => {
    const theirs = server('t1', 'uploading', { userId: 'them' });
    expect(mergeServerRows([], [theirs])).toEqual([theirs]);
  });
});

describe('uploadFromDoc', () => {
  it('reads a published document, dates included', () => {
    expect(
      uploadFromDoc({
        _id: 'u1',
        userId: 'me',
        type: 'ticket.video',
        targetKey: 'ticket:abc',
        state: 'uploading',
        name: 'Fix login',
        durationMs: 4200,
        sentAt: new Date('2026-11-19T10:00:00.000Z'),
        updatedAt: { $date: Date.parse('2026-11-19T10:01:00.000Z') },
        reason: null,
      }),
    ).toEqual({
      id: 'u1',
      userId: 'me',
      type: 'ticket.video',
      targetKey: 'ticket:abc',
      state: 'uploading',
      name: 'Fix login',
      durationMs: 4200,
      sentAt: '2026-11-19T10:00:00.000Z',
      updatedAt: '2026-11-19T10:01:00.000Z',
      reason: null,
      note: null,
      attachmentId: null,
      mediaId: null,
    });
  });

  it('skips a document without an id or a state', () => {
    expect(uploadFromDoc({ state: 'uploading' })).toBeNull();
    expect(uploadFromDoc({ _id: 'u1' })).toBeNull();
  });
});

describe('isMoving', () => {
  it('is true for a video on its way, false once landed or idle', () => {
    expect(isMoving({ local: draft('d', 'uploading'), server: null, landed: false })).toBe(true);
    expect(isMoving({ local: null, server: server('u', 'processing'), landed: false })).toBe(true);
    expect(isMoving({ local: draft('d', 'ready'), server: null, landed: false })).toBe(false);
    expect(isMoving({ local: draft('d', 'delivering'), server: null, landed: true })).toBe(false);
  });
});

describe('newlyDelivered / leftPublication', () => {
  it('names rows seen on their way that are now delivered', () => {
    const before = new Map<string, PulseUploadState>([
      ['a', 'processing'],
      ['b', 'delivered'],
    ]);
    const now = [server('a', 'delivered'), server('b', 'delivered'), server('c', 'delivered')];
    expect(newlyDelivered(before, now).map((u) => u.id)).toEqual(['a']);
  });

  it('names rows the live publication dropped', () => {
    expect(leftPublication(new Set(['a', 'b']), [{ id: 'b' }, { id: 'c' }])).toEqual(['a']);
  });
});

describe('useLiveUploads', () => {
  /** A `pulseUploads.list` reply the test answers when it chooses. */
  function deferredLists() {
    const pending: {
      targetKey: string;
      resolve: (rows: PulseUploadPublic[]) => void;
    }[] = [];
    vi.spyOn(pulseUploadApi, 'list').mockImplementation(
      (args) =>
        new Promise((resolve) => {
          pending.push({
            targetKey: args?.targetKey ?? '',
            resolve: (uploads) => resolve({ uploads }),
          });
        }),
    );
    return pending;
  }

  function quietDdp() {
    const ddp = getDdpClient();
    vi.spyOn(ddp, 'subscribe').mockReturnValue(() => {});
    vi.spyOn(ddp, 'onCollectionChange').mockReturnValue(() => {});
    vi.spyOn(ddp, 'onReconnect').mockReturnValue(() => {});
    vi.spyOn(ddp, 'docs').mockReturnValue([]);
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('drops a read for the previous place and reads the new one at once', async () => {
    quietDdp();
    const pending = deferredLists();
    const onLanded = vi.fn();
    const { result, rerender } = renderHook(({ key }) => useLiveUploads(key, { onLanded }), {
      initialProps: { key: 'ticket:a' },
    });
    expect(pending.map((p) => p.targetKey)).toEqual(['ticket:a']);

    // Another place while the first read is still on its way.
    rerender({ key: 'ticket:b' });
    expect(pending.map((p) => p.targetKey)).toEqual(['ticket:a', 'ticket:b']);
    expect(result.current.loading).toBe(true);

    // The old place answers last but one: its rows never show.
    await act(async () => {
      pending[0].resolve([server('old', 'delivered', { targetKey: 'ticket:a' })]);
    });
    expect(result.current.uploads).toEqual([]);

    await act(async () => {
      pending[1].resolve([server('new', 'uploading', { targetKey: 'ticket:b' })]);
    });
    expect(result.current.uploads.map((u) => u.id)).toEqual(['new']);
    expect(result.current.loading).toBe(false);
    expect(onLanded).not.toHaveBeenCalled();
  });

  it("clears the previous place's rows as soon as the key changes", async () => {
    quietDdp();
    const pending = deferredLists();
    const onLanded = vi.fn();
    const { result, rerender } = renderHook(({ key }) => useLiveUploads(key, { onLanded }), {
      initialProps: { key: 'ticket:a' },
    });
    await act(async () => {
      pending[0].resolve([server('a1', 'uploading', { targetKey: 'ticket:a' })]);
    });
    expect(result.current.uploads.map((u) => u.id)).toEqual(['a1']);

    rerender({ key: 'ticket:b' });
    expect(result.current.uploads).toEqual([]);
    await act(async () => {
      pending[1].resolve([]);
    });
    expect(result.current.uploads).toEqual([]);
    expect(onLanded).not.toHaveBeenCalled();
  });

  it('reads once more when asked during a read for the same place', async () => {
    quietDdp();
    const pending = deferredLists();
    const { result } = renderHook(() => useLiveUploads('ticket:a'));
    act(() => result.current.refresh());
    expect(pending).toHaveLength(1);
    await act(async () => {
      pending[0].resolve([server('a1', 'uploading', { targetKey: 'ticket:a' })]);
    });
    expect(pending).toHaveLength(2);
    await act(async () => {
      pending[1].resolve([server('a1', 'delivered', { targetKey: 'ticket:a' })]);
    });
    expect(result.current.uploads.map((u) => u.state)).toEqual(['delivered']);
  });
});
