import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MediaFeedRenderContext } from '@mieweb/ui';
import type { SuperChatMediaAttachment, SuperChatMediaItem } from '@mieweb/ui/components/SuperChat';
import {
  FeedPlayer,
  renderSuperChatMedia,
  VideoFeedView,
  type FeedPlayerContext,
  type FeedVideo,
} from './VideoFeedView';

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

  it('leaves Escape to a video’s open ⋯ menu first', () => {
    render(
      <VideoFeedView videos={[{ id: FIRST, name: 'Standup' }]} openId={FIRST} onClose={() => {}} />,
    );
    const more = screen.getByRole('button', { name: 'More for Standup' });
    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(more, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Videos' })).toBeTruthy();
  });

  it.each([
    ['its ⋯', () => screen.getByRole('button', { name: 'More for Standup' })],
    ['an item of its menu', () => screen.getByRole('menuitem', { name: 'Copy link' })],
  ])('closes only an open ⋯ menu on Escape from %s, not a window under the feed', (_, target) => {
    const underneath = vi.fn();
    document.addEventListener('keydown', underneath);
    render(
      <VideoFeedView videos={[{ id: FIRST, name: 'Standup' }]} openId={FIRST} onClose={() => {}} />,
    );
    const more = screen.getByRole('button', { name: 'More for Standup' });
    fireEvent.click(more);
    fireEvent.keyDown(target(), { key: 'Escape' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('dialog', { name: 'Videos' })).toBeTruthy();
    expect(underneath).not.toHaveBeenCalled();
    document.removeEventListener('keydown', underneath);
  });

  it('closes only the ⋯ menu on Escape from another control while that menu is open', () => {
    const onClose = vi.fn();
    render(
      <VideoFeedView videos={[{ id: FIRST, name: 'Standup' }]} openId={FIRST} onClose={onClose} />,
    );
    const more = screen.getByRole('button', { name: 'More for Standup' });
    fireEvent.click(more);
    // Focus moved on to another control in the feed, the menu still open.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Back' }), { key: 'Escape' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(onClose).not.toHaveBeenCalled();
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

describe('VideoFeedView captions', () => {
  afterEach(cleanup);

  const CAPTIONS = '7d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
  const videoOf = (name: string) =>
    screen.getByRole('article', { name }).querySelector<HTMLVideoElement>('video');

  it('plays a video that has captions with its captions track, asking for it with CORS', () => {
    render(
      <VideoFeedView
        videos={[{ id: FIRST, name: 'Standup', captionsUrl: `/pulsevault/artifacts/${CAPTIONS}` }]}
        openId={FIRST}
        onClose={() => {}}
      />,
    );
    const video = videoOf('Standup');
    expect(video?.getAttribute('src')).toBe(`/pulsevault/artifacts/${FIRST}`);
    expect(video?.getAttribute('crossorigin')).toBe('anonymous');
    const tracks = video?.querySelectorAll('track') ?? [];
    expect(tracks).toHaveLength(1);
    expect(tracks[0].getAttribute('kind')).toBe('captions');
    expect(tracks[0].getAttribute('src')).toBe(`/pulsevault/artifacts/${CAPTIONS}`);
    expect(tracks[0].getAttribute('srclang')).toBe('en');
    expect(tracks[0].getAttribute('label')).toBe('Captions');
    expect(tracks[0].hasAttribute('default')).toBe(true);
  });

  it('gives a video without captions no track and no CORS mode, beside one with them', () => {
    render(
      <VideoFeedView
        videos={[
          { id: FIRST, name: 'Standup', captionsUrl: `/pulsevault/artifacts/${CAPTIONS}` },
          { id: SECOND, name: 'Sprint demo', captionsUrl: null },
        ]}
        openId={SECOND}
        onClose={() => {}}
      />,
    );
    const video = videoOf('Sprint demo');
    expect(video).not.toBeNull();
    expect(video?.querySelector('track')).toBeNull();
    expect(video?.hasAttribute('crossorigin')).toBe(false);
    expect(videoOf('Standup')?.querySelector('track')).not.toBeNull();
  });

  it('starts the video it opens on, with captions as without', () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    render(
      <VideoFeedView
        videos={[
          { id: FIRST, name: 'Standup', captionsUrl: `/pulsevault/artifacts/${CAPTIONS}` },
          { id: SECOND, name: 'Sprint demo' },
        ]}
        openId={SECOND}
        onClose={() => {}}
      />,
    );
    expect(play.mock.contexts).toContain(videoOf('Sprint demo'));
    expect(play.mock.contexts).not.toContain(videoOf('Standup'));
    vi.restoreAllMocks();
  });

  it('adds no track to a feed where no video has captions', () => {
    render(<VideoFeedView videos={VIDEOS} openId={FIRST} onClose={() => {}} />);
    const feed = screen.getByRole('dialog', { name: 'Videos' });
    expect(feed.querySelectorAll('video').length).toBeGreaterThan(0);
    expect(feed.querySelector('track')).toBeNull();
    expect(feed.querySelector('video[crossorigin]')).toBeNull();
    expect(screen.queryByRole('button', { name: /captions/i })).toBeNull();
  });

  it("adds no track for captions that aren't a PulseVault artifact", () => {
    render(
      <VideoFeedView
        videos={[{ id: FIRST, name: 'Standup', captionsUrl: 'https://elsewhere.test/c.vtt' }]}
        openId={FIRST}
        onClose={() => {}}
      />,
    );
    expect(document.querySelector('track')).toBeNull();
  });
});

describe('FeedPlayer', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const CAPTIONS_URL = '/pulsevault/artifacts/7d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
  const MEDIA = { kind: 'video', src: `/pulsevault/artifacts/${FIRST}` } as const;
  const context = (over: Partial<FeedPlayerContext>): FeedPlayerContext => ({
    active: true,
    autoPlay: false,
    muted: false,
    loop: false,
    playbackRequestId: undefined,
    ...over,
  });
  const spies = () => ({
    play: vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined),
    pause: vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}),
  });

  it('starts once when the feed both autoplays and asks it to play', () => {
    const { play } = spies();
    render(
      <FeedPlayer
        media={MEDIA}
        context={context({ autoPlay: true, playbackRequestId: 'open' })}
        captionsUrl={CAPTIONS_URL}
      />,
    );
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('handles each Play request once, and a new one again', () => {
    const { play } = spies();
    const { rerender } = render(
      <FeedPlayer media={MEDIA} context={context({ playbackRequestId: 1 })} />,
    );
    rerender(<FeedPlayer media={MEDIA} context={context({ playbackRequestId: 1 })} />);
    expect(play).toHaveBeenCalledTimes(1);
    rerender(<FeedPlayer media={MEDIA} context={context({ playbackRequestId: 2 })} />);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('pauses when another item takes over', () => {
    const { pause } = spies();
    const { container, rerender } = render(
      <FeedPlayer media={MEDIA} context={context({ autoPlay: true })} captionsUrl={CAPTIONS_URL} />,
    );
    const video = container.querySelector('video');
    pause.mockClear();
    rerender(
      <FeedPlayer
        media={MEDIA}
        context={context({ active: false, autoPlay: true })}
        captionsUrl={CAPTIONS_URL}
      />,
    );
    expect(pause.mock.contexts).toContain(video);
  });
});

describe('renderSuperChatMedia', () => {
  afterEach(cleanup);

  const CAPTIONS_URL = '/pulsevault/artifacts/7d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
  /** Huddle's media view rendering one message's media item, as SuperChat's MediaFeed does. */
  const renderItem = (attachment: SuperChatMediaAttachment) => {
    const context = {
      item: { id: `c:m:${attachment.id}`, conversationId: 'c', attachment } as SuperChatMediaItem,
      active: true,
      autoPlay: false,
      muted: false,
      loop: false,
    } satisfies MediaFeedRenderContext<SuperChatMediaItem>;
    return render(<>{renderSuperChatMedia(attachment, context)}</>).container;
  };
  const pulseVideo = (extra: object = {}): SuperChatMediaAttachment => ({
    id: FIRST,
    kind: 'video',
    src: `/pulsevault/artifacts/${FIRST}`,
    title: 'Standup',
    ...extra,
  });

  it('plays a Pulse video that carries captions with its track, asking for it with CORS', () => {
    const video = renderItem(pulseVideo({ captionsUrl: CAPTIONS_URL })).querySelector('video');
    expect(video?.getAttribute('src')).toBe(`/pulsevault/artifacts/${FIRST}`);
    expect(video?.getAttribute('crossorigin')).toBe('anonymous');
    const tracks = video?.querySelectorAll('track') ?? [];
    expect(tracks).toHaveLength(1);
    expect(tracks[0].getAttribute('kind')).toBe('captions');
    expect(tracks[0].getAttribute('src')).toBe(CAPTIONS_URL);
    expect(tracks[0].getAttribute('label')).toBe('Captions');
  });

  it('plays a video without captions with no track and no CORS mode', () => {
    for (const extra of [{}, { captionsUrl: null }]) {
      const video = renderItem(pulseVideo(extra)).querySelector('video');
      expect(video?.getAttribute('src')).toBe(`/pulsevault/artifacts/${FIRST}`);
      expect(video?.hasAttribute('crossorigin')).toBe(false);
      expect(video?.querySelector('track')).toBeNull();
      cleanup();
    }
  });

  it('shows a picture as it is', () => {
    const container = renderItem({
      id: 'photo',
      kind: 'image',
      src: '/uploads/whiteboard.jpg',
      alt: 'whiteboard.jpg',
    });
    expect(container.querySelector('video')).toBeNull();
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/uploads/whiteboard.jpg');
    expect(img?.getAttribute('alt')).toBe('whiteboard.jpg');
  });
});
