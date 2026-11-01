/**
 * VideoFeedView — where a video card's ▶ plays it outside Huddle (a ticket's
 * or a clock session's Videos, a timesheet walkthrough): the card's videos in
 * a feed over the whole window, opened on the one tapped and playing it,
 * scrolling up and down to the others. Laid out as Huddle's media view and the
 * video's own page are — the same MediaFeed — with each video's ⋯ menu. Back
 * or Escape closes it, and focus returns to the ▶ that opened it.
 */
import { ArrowLeftIcon, Button, MediaFeed, useFocusTrap } from '@mieweb/ui';
import React, { useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

import { resolveMediaUrl } from '@lib/api';
import { useEscapeWithin } from '@lib/useEscapeWithin';
import { artifactPath, posterPath, videoLabel } from './artifact';
import { VideoMenu } from './VideoMenu';

/** User-facing copy, kept together for translation. */
const FEED_COPY = {
  feed: 'Videos',
  back: 'Back',
};

/** One video in the feed. */
export interface FeedVideo {
  /** Its PulseVault artifact id. */
  id: string;
  /** Its name (null: none). */
  name: string | null;
  /** The viewer owns it: its menu offers Rename. */
  renamable?: boolean;
  /** Where the host lets the viewer take it off: its menu offers Remove. */
  onRemove?: () => void;
}

interface VideoFeedViewProps {
  videos: readonly FeedVideo[];
  /** The video it opens on, playing; null while closed. */
  openId: string | null;
  onClose: () => void;
  /** After a rename in the feed, with the name the server kept (null: none). */
  onRenamed?: (id: string, name: string | null) => void;
}

export function VideoFeedView({ videos, openId, onClose, onRenamed }: VideoFeedViewProps) {
  const open = openId !== null && videos.some((video) => video.id === openId);
  // Focus starts on the video it opens on, not Back, so the arrow keys move
  // through the feed at once.
  const viewRef = useFocusTrap<HTMLDivElement>(open, { initialFocus: false });
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() =>
      viewRef.current
        ?.querySelector<HTMLElement>('[data-active="true"], [role="feed"]')
        ?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [open, viewRef]);

  // Back where it was opened from, and the page under it held still meanwhile.
  // A layout effect, to see the opener before the focus trap moves focus in.
  useLayoutEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, [open]);

  // Escape closes it, and not the window under it. One pressed in a rename
  // (on the body, outside it) closes only that.
  useEscapeWithin(viewRef, onClose, open);

  if (!open) return null;
  return createPortal(
    <div
      ref={viewRef}
      role="dialog"
      aria-modal="true"
      aria-label={FEED_COPY.feed}
      data-theme="dark"
      className="video-feed-view fixed inset-0 z-50 bg-black pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] text-white"
    >
      {/* Inside the safe areas, so Back clears the notch too. */}
      <div className="video-feed-frame relative h-full">
        <Button
          variant="ghost"
          size="icon"
          className="absolute start-2 top-2 z-20 h-10 w-10 rounded-full bg-black/45 p-0 text-white backdrop-blur-sm hover:bg-black/65 hover:text-white focus-visible:ring-2 focus-visible:ring-white pointer-fine:h-9 pointer-fine:w-9"
          aria-label={FEED_COPY.back}
          title={FEED_COPY.back}
          onClick={onClose}
        >
          <ArrowLeftIcon className="h-5 w-5 rtl:rotate-180" />
        </Button>
        <MediaFeed
          className="h-full"
          layout="overlay"
          items={videos}
          getId={(video) => video.id}
          getMedia={(video) => ({
            kind: 'video',
            src: resolveMediaUrl(artifactPath(video.id)),
            poster: resolveMediaUrl(posterPath(video.id)),
          })}
          getTitle={(video) => videoLabel(video.name, video.id)}
          renderActions={(video) => (
            <VideoMenu
              video={video.id}
              name={video.name}
              label={videoLabel(video.name, video.id)}
              renamable={video.renamable}
              onRenamed={(name) => onRenamed?.(video.id, name)}
              onRemove={video.onRemove}
            />
          )}
          defaultActiveItemId={openId}
          // Started by the ▶ that opened it, with its sound; as in Huddle's
          // media view, each one plays as it's scrolled to.
          playbackRequest={{ itemId: openId, requestId: openId }}
          muted={false}
          allowFullscreen={false}
          labels={{ feed: FEED_COPY.feed }}
        />
      </div>
    </div>,
    document.body,
  );
}
