import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { PulseVideoMark } from '../../lib/api';
import { PulsePendingNote, pulsePendingNote, pulsePendingNotes } from './PulsePendingNote';

const mark = (role: 'plan' | 'wrapup', over: Partial<PulseVideoMark> = {}): PulseVideoMark => ({
  uploadId: `up-${role}`,
  role,
  at: '2026-11-18T17:02:00.000Z',
  ...over,
});

describe('pulsePendingNote', () => {
  it('says nothing for a post waiting for no video', () => {
    expect(pulsePendingNote({})).toBeNull();
    expect(pulsePendingNote({ pendingVideos: [], missingVideos: [] })).toBeNull();
  });

  it('says a video sent with its clock action is on its way', () => {
    expect(pulsePendingNote({ pendingVideos: [mark('wrapup')] })).toBe('Video on its way');
    expect(pulsePendingNote({ pendingVideos: [mark('plan')] })).toBe('Video on its way');
  });

  it("says a video still on its way 24 h after Send hasn't arrived yet", () => {
    const overdueAt = '2026-11-19T17:02:00.000Z';
    expect(pulsePendingNote({ pendingVideos: [mark('wrapup', { overdueAt })] })).toBe(
      "Wrap-up video hasn't arrived yet",
    );
    expect(pulsePendingNote({ pendingVideos: [mark('plan', { overdueAt })] })).toBe(
      "Plan video hasn't arrived yet",
    );
    // `overdueAt: null` is the server's "not yet".
    expect(pulsePendingNote({ pendingVideos: [mark('wrapup', { overdueAt: null })] })).toBe(
      'Video on its way',
    );
  });

  it("says a video that won't come didn't arrive", () => {
    expect(pulsePendingNote({ missingVideos: [mark('wrapup')] })).toBe(
      "Wrap-up video didn't arrive",
    );
    expect(pulsePendingNote({ missingVideos: [mark('plan')] })).toBe("Plan video didn't arrive");
  });

  it('says each thing once, the missing first', () => {
    const notes = pulsePendingNotes({
      pendingVideos: [
        mark('plan'),
        mark('wrapup', { uploadId: 'a', overdueAt: '2026-11-19T00:00:00Z' }),
        mark('wrapup', { uploadId: 'b' }),
      ],
      missingVideos: [mark('wrapup', { uploadId: 'c' }), mark('wrapup', { uploadId: 'd' })],
    });
    expect(notes).toEqual([
      "Wrap-up video didn't arrive",
      "Wrap-up video hasn't arrived yet",
      'Video on its way',
    ]);
  });
});

describe('PulsePendingNote', () => {
  afterEach(cleanup);

  it('shows the note in a polite live region', () => {
    render(<PulsePendingNote post={{ pendingVideos: [mark('wrapup')] }} />);
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('Video on its way');
  });

  it('keeps the live region, empty, when the video has landed', () => {
    const { rerender } = render(<PulsePendingNote post={{ pendingVideos: [mark('wrapup')] }} />);
    rerender(<PulsePendingNote post={{ pendingVideos: [] }} />);
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('says a late or missing video as a warning, one on its way quietly', () => {
    const { rerender } = render(<PulsePendingNote post={{ pendingVideos: [mark('wrapup')] }} />);
    const quiet = screen.getByText('Video on its way').className;
    rerender(<PulsePendingNote post={{ missingVideos: [mark('wrapup')] }} />);
    const warning = screen.getByText("Wrap-up video didn't arrive").className;
    expect(warning).not.toBe(quiet);
  });
});
