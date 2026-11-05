import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Attachment } from '@lib/api';
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
vi.mock('@lib/api', () => ({
  resolveMediaUrl: (path: string) => path,
  METEOR_BASE_URL: 'http://localhost:3100',
  attachmentApi: {
    list: listAttachments,
    remove: () => Promise.resolve(),
  },
  videoApi: { rename: (_video: string, name: string) => Promise.resolve(name.trim() || null) },
}));
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

  it('says Processing once its bytes are in, and keeps it until its card is in the list', async () => {
    const LANDED = '7d4e1c2a-9b3f-4e5d-8a6b-1c2d3e4f5a6b';
    await renderPanel();
    await pickDemo();
    act(() => uploads[0].onProgress(1));
    expect(screen.getByText('Processing…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel upload of demo.mov' })).toBeNull();
    // Landed, and the list fetched again still without it: still Processing.
    await act(async () => uploads[0].resolve(LANDED));
    expect(listAttachments).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Processing…')).toBeTruthy();
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
