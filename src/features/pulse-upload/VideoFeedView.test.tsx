import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VideoFeedView, type FeedVideo } from './VideoFeedView';

vi.mock('@lib/api', () => ({
  resolveMediaUrl: (path: string) => path,
  METEOR_BASE_URL: 'http://localhost:3100',
}));

const FIRST = '0b7e7c1e-5a3f-4c1d-9e2a-6f1d2c3b4a59';
const SECOND = '1c8f8d2f-6b4a-4d2e-8f3b-7a2e3d4c5b6a';
const VIDEOS: FeedVideo[] = [
  { id: FIRST, name: 'Standup' },
  { id: SECOND, name: 'Sprint demo' },
];

/** A card's ▶ and the feed it opens, as a host wires them. */
function Host() {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <>
      <button type="button" onClick={() => setOpenId(SECOND)}>
        Play Sprint demo
      </button>
      <VideoFeedView videos={VIDEOS} openId={openId} onClose={() => setOpenId(null)} />
    </>
  );
}

describe('VideoFeedView', () => {
  afterEach(cleanup);

  it('opens over the page on the video tapped, with the others in the feed', () => {
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'Play Sprint demo' }));
    const feed = screen.getByRole('dialog', { name: 'Videos' });
    expect(feed.parentElement).toBe(document.body);
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getByRole('article', { name: 'Sprint demo' }).getAttribute('data-active')).toBe(
      'true',
    );
  });

  it('closes on Back and returns focus to the ▶ that opened it', () => {
    render(<Host />);
    const play = screen.getByRole('button', { name: 'Play Sprint demo' });
    play.focus();
    fireEvent.click(play);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(play);
  });

  it('closes on Escape without it reaching a window under it', () => {
    const underneath = vi.fn();
    document.addEventListener('keydown', underneath);
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'Play Sprint demo' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Back' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(underneath).not.toHaveBeenCalled();
    document.removeEventListener('keydown', underneath);
  });
});
