import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('@lib/api', () => ({
  resolveMediaUrl: (path: string) => path,
  METEOR_BASE_URL: 'http://localhost:3100',
  attachmentApi: {
    list: () =>
      Promise.resolve([
        row('a1', `/pulsevault/artifacts/${VIDEO}`),
        row('a2', `http://localhost:3100/pulsevault/artifacts/${VIDEO}`),
      ]),
    remove: () => Promise.resolve(),
  },
  videoApi: { rename: (_video: string, name: string) => Promise.resolve(name.trim() || null) },
}));
vi.mock('../pulse-upload/PulseButton', () => ({ PulseControls: () => null }));
// The Pulse upload the panel holds; a test sets what it's sending.
const pulse = vi.hoisted(() => ({
  file: null as File | null,
  progress: null as number | null,
  processing: false,
  cancel: vi.fn(),
}));
vi.mock('../pulse-upload/usePulseUpload', () => ({ usePulseUpload: () => pulse }));

describe('AttachmentsPanel', () => {
  afterEach(() => {
    cleanup();
    pulse.file = null;
    pulse.progress = null;
    pulse.processing = false;
    pulse.cancel.mockClear();
  });

  it('shows the video on its way up in the list, with its progress, and cancels it', async () => {
    pulse.file = new File(['x'], 'demo.mov', { type: 'video/quicktime' });
    pulse.progress = 0.42;
    await act(async () => {
      render(<AttachmentsPanel kind="ticket" entityId="t1" currentUserId="u1" />);
    });
    expect(
      screen.getByRole('progressbar', { name: 'Uploading demo.mov' }).getAttribute('aria-valuenow'),
    ).toBe('42');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel upload of demo.mov' }));
    expect(pulse.cancel).toHaveBeenCalledTimes(1);
  });

  it('says Processing once its bytes are in, with nothing left to cancel', async () => {
    pulse.file = new File(['x'], 'demo.mov', { type: 'video/quicktime' });
    pulse.processing = true;
    await act(async () => {
      render(<AttachmentsPanel kind="ticket" entityId="t1" currentUserId="u1" />);
    });
    expect(screen.getByText('Processing…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel upload of demo.mov' })).toBeNull();
  });

  it("renames every card of a video, however each row's URL was stored", async () => {
    await act(async () => {
      render(<AttachmentsPanel kind="ticket" entityId="t1" currentUserId="u1" />);
    });
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
