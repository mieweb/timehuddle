/**
 * VideoFeedView — where a video card's ▶ plays it outside Huddle (a ticket's
 * or a clock session's Videos, a timesheet walkthrough): the card's videos in
 * a feed over the whole window, opened on the one tapped and playing it,
 * scrolling up and down to the others. Laid out as Huddle's media view and the
 * video's own page are — the same MediaFeed — with each video's ⋯ menu. Back
 * or Escape closes it, and focus returns to the ▶ that opened it.
 *
 * A video with captions plays with them (captions.ts). MediaFeed's own player
 * has no place for a track yet, so a feed with a captioned video plays its
 * videos in {@link FeedPlayer} through MediaFeed's `renderMedia`; a feed
 * without one keeps MediaFeed's player.
 */
import {
  ArrowLeftIcon,
  Button,
  MediaFeed,
  MediaPlayer,
  useFocusTrap,
  type MediaFeedMedia,
  type MediaFeedRenderContext,
} from '@mieweb/ui';
import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

import { resolveMediaUrl } from '@lib/api';
import { useEscapeWithin } from '@lib/useEscapeWithin';
import { artifactPath, posterPath, videoLabel } from './artifact';
import { CAPTIONS_CROSS_ORIGIN, trackProps, type CaptionTrackProps } from './captions';
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
  /** Its captions (the server's `captionsUrl`); null or absent: none. */
  captionsUrl?: string | null;
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

  const captioned = videos.some((video) => trackProps(video.captionsUrl) !== null);

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
          renderMedia={
            captioned
              ? (media, context) => (
                  <FeedPlayer
                    media={media}
                    context={context}
                    captionsUrl={context.item.captionsUrl}
                    title={videoLabel(context.item.name, context.item.id)}
                  />
                )
              : undefined
          }
          renderActions={(video) => (
            <VideoMenu
              video={video.id}
              name={video.name}
              label={videoLabel(video.name, video.id)}
              renamable={video.renamable}
              onRenamed={(name) => onRenamed?.(video.id, name)}
              onRemove={video.onRemove}
              inFeed
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

/** What {@link FeedPlayer} needs of MediaFeed's `renderMedia` context. */
export type FeedPlayerContext = Pick<
  MediaFeedRenderContext<unknown>,
  'active' | 'autoPlay' | 'muted' | 'loop' | 'playbackRequestId'
>;

interface FeedPlayerProps {
  /** The item's media, as MediaFeed hands it to `renderMedia`. */
  media: MediaFeedMedia;
  context: FeedPlayerContext;
  /** The video's captions (the server's `captionsUrl`); null or absent: none. */
  captionsUrl?: string | null;
  /** What to call it, for screen readers. */
  title?: string;
}

/**
 * One item of a MediaFeed, for its `renderMedia`, playing a video with its
 * captions until MediaFeed's own player takes a track: the same player
 * (MediaPlayer with the overlay controls, whose captions button shows only
 * when there's a track) and the feed's playback rules — it plays only while
 * it's the active item, starts on its own when the feed autoplays, and once
 * for each Play request the feed hands it. A picture shows as it is.
 *
 * Keyed by its source and captions, so a change of either starts a fresh
 * player, with the video's CORS mode set before it loads.
 */
export function FeedPlayer(props: FeedPlayerProps) {
  const track = trackProps(props.captionsUrl);
  if (props.media.kind === 'image') {
    return (
      <img
        src={props.media.src}
        alt={props.media.alt ?? props.title ?? ''}
        loading="lazy"
        className="h-full max-h-full w-full object-contain"
      />
    );
  }
  return (
    <FeedPlayerVideo key={`${props.media.src} ${track?.src ?? ''}`} {...props} track={track} />
  );
}

function FeedPlayerVideo({
  media,
  context: { active, autoPlay, muted, loop, playbackRequestId },
  title,
  track,
}: FeedPlayerProps & { track: CaptionTrackProps | null }) {
  const element = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  // MediaPlayer hands its element over here as it mounts, before the browser
  // fetches the video or its track (both wait for the task to finish), so the
  // track's request is a CORS one. Without a track the video loads as before.
  // One object for the player's life (the key changes with the track), so
  // MediaPlayer doesn't let go of its element on every render.
  const captioned = track !== null;
  const mediaElementRef = useMemo<React.RefObject<HTMLVideoElement | HTMLAudioElement | null>>(
    () => ({
      get current() {
        return element.current;
      },
      set current(el) {
        if (el && captioned) el.crossOrigin = CAPTIONS_CROSS_ORIGIN;
        element.current = el;
      },
    }),
    [captioned],
  );

  // Only the active item plays: it starts on its own when the feed autoplays,
  // and stops when another item takes over.
  useEffect(() => {
    const el = element.current;
    if (!el) return;
    if (active && autoPlay) play(el);
    else if (!active) el.pause();
  }, [active, autoPlay]);

  // A Play request (a tap on a card's ▶) is handled once, by the active item.
  const handledRequest = useRef<string | number | undefined>(undefined);
  useEffect(() => {
    if (!active || playbackRequestId === undefined || playbackRequestId === handledRequest.current)
      return;
    handledRequest.current = playbackRequestId;
    if (element.current) play(element.current);
  }, [active, playbackRequestId]);

  // Nothing plays on once it's gone.
  useEffect(() => {
    const el = element.current;
    return () => el?.pause();
  }, []);

  return (
    <div className="feed-player relative flex h-full min-h-0 w-full flex-col items-center justify-center">
      <MediaPlayer
        src={media.src}
        kind={media.kind === 'audio' ? 'audio' : 'video'}
        poster={media.poster}
        mediaElementRef={mediaElementRef}
        muted={muted}
        loop={loop}
        preload={active ? 'metadata' : 'none'}
        controls={active}
        controlsStyle="overlay"
        aria-label={title}
        className="min-h-0 flex-1 [&_video]:h-full [&_video]:w-full"
      >
        {track && <track {...track} />}
      </MediaPlayer>
    </div>
  );
}

/** Start playing; a refusal (autoplay blocked) leaves the player's own ▶ to do it. */
function play(el: HTMLMediaElement) {
  try {
    void el.play()?.catch(() => {});
  } catch {
    // A browser without media playback (tests) has nothing to start.
  }
}
