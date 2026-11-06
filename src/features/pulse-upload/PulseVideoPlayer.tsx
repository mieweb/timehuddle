/**
 * PulseVideoPlayer — how a Pulse video shows anywhere in the app (Huddle posts,
 * ticket and clock-session attachments, timesheet walkthroughs): its poster
 * frame with its name and a play button, which opens the host's feed to play
 * it (Huddle's media view, VideoFeedView elsewhere).
 *
 * Takes the PulseVault artifact **id**, never a URL, and builds every URL
 * itself (see artifact.ts), so it can only ever point at this backend. The
 * poster is looked up by the video's id, so it shows whichever order Pulse
 * uploaded the two in.
 *
 * Loads nothing but its poster, so a long list of videos costs one image each.
 */
import { faPlay } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button } from '@mieweb/ui';
import React, { useCallback, useEffect, useState } from 'react';

import { resolveMediaUrl } from '@lib/api';
import { posterPath } from './artifact';
import { VideoMenu } from './VideoMenu';

/**
 * How long to wait before each new look for a poster that wasn't there: the
 * card can ask before Pulse's thumbnail has finished uploading. After these
 * (about a minute and a half) the video keeps its plain box.
 */
export const POSTER_RETRY_MS = [2_000, 5_000, 10_000, 20_000, 40_000];

/**
 * The poster to show (null while there's none) and what its `<img>` calls when
 * it fails. A miss is looked for again in the background: the card keeps its
 * plain box meanwhile instead of flickering, and switches once a look finds it
 * (at that URL, already loaded).
 */
export function usePoster(video: string): { src: string | null; onError: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!missing || attempt >= POSTER_RETRY_MS.length) return;
    let probe: HTMLImageElement | null = null;
    const next = attempt + 1;
    const timer = setTimeout(() => {
      probe = new Image();
      probe.onload = () => {
        setAttempt(next);
        setMissing(false);
      };
      probe.onerror = () => setAttempt(next);
      probe.src = posterUrl(video, next);
    }, POSTER_RETRY_MS[attempt]);
    return () => {
      clearTimeout(timer);
      if (probe) probe.onload = probe.onerror = null;
    };
  }, [missing, attempt, video]);

  const onError = useCallback(() => setMissing(true), []);
  return { src: missing ? null : posterUrl(video, attempt), onError };
}

/** A fresh URL for each look, so a cached 404 can't answer for a later one. */
function posterUrl(video: string, attempt: number): string {
  return resolveMediaUrl(
    attempt === 0 ? posterPath(video) : `${posterPath(video)}?attempt=${attempt}`,
  );
}

/** User-facing copy, kept together for translation. */
const PLAYER_COPY = {
  untitled: 'Pulse video',
  play: (video: string) => `Play ${video}`,
};

/**
 * A video card's box, both ways, as a CSS length: a wide clip up to this wide,
 * an upright one up to this tall, and at most 40% of a short screen. Huddle
 * gives SuperChat the same (`mediaMaxSize`), so its cards match.
 */
export const VIDEO_CARD_SIZE = 'min(16rem, 40dvh)';

/**
 * The card's box: its shape (width ÷ height) once known, so the poster fills
 * it — nothing cropped, no bars — and its width: `size`, or narrower for an
 * upright clip so it isn't taller than `size`. The same however long the
 * message. Not a percentage: the message sizes itself to the card, and
 * `max-w-full` on the card still fits it, shape and all, inside a narrower
 * one. `--card-size` gives the poster its height cap.
 */
export function cardBox(aspect: number | null, size: string): React.CSSProperties {
  return {
    ['--card-size' as string]: size,
    ...(aspect
      ? { aspectRatio: String(aspect), width: `min(${size}, calc(${size} * ${aspect}))` }
      : { width: size }),
  };
}

interface PulseVideoPlayerProps {
  /** The video's PulseVault artifact id. */
  video: string;
  /** What to call it — the Pulse draft's name — for screen readers. */
  title?: string;
  /** The video's name, shown on its poster until it plays — the same on every card. */
  caption?: string | null;
  /**
   * The viewer owns it: the card's ⋯ menu offers Rename (or Add a name). The
   * server checks ownership again, so this only decides what's offered.
   */
  renamable?: boolean;
  /** After a rename here, with the name the server kept (null: none). */
  onRenamed?: (name: string | null) => void;
  /** Where the host lets the viewer take it off (a ticket's Videos): the menu offers Remove. */
  onRemove?: () => void;
  /**
   * ▶: the host's feed, playing this video (Huddle's media view, VideoFeedView).
   * Without it ▶ is off (SuperChat while the message is being edited).
   */
  onOpen?: () => void;
  /** Marks ▶ for the host to return focus to (SuperChat's `data-media-launch-id`). */
  launchId?: string;
  /** The card's box (SuperChat's `maxSize` in Huddle). @default VIDEO_CARD_SIZE */
  maxSize?: string;
}

/**
 * Keyed by the video: a host that swaps the video under it (the approvals
 * window moving to the next request) gets a fresh card — its own looks for
 * the poster and its shape — not the last video's state.
 */
export function PulseVideoPlayer(props: PulseVideoPlayerProps) {
  return <PulseVideoCard key={props.video} {...props} />;
}

function PulseVideoCard({
  video,
  title,
  caption,
  renamable,
  onRenamed,
  onRemove,
  onOpen,
  launchId,
  maxSize = VIDEO_CARD_SIZE,
}: PulseVideoPlayerProps) {
  // The card keeps the name it shows, so a rename here shows at once.
  const [shownName, setShownName] = useState(caption ?? null);
  useEffect(() => setShownName(caption ?? null), [caption]);
  // No poster (yet), or it failed to load: the same plain box with the ▶.
  const poster = usePoster(video);
  // The shape, from the poster.
  const [aspect, setAspect] = useState<number | null>(null);
  const learnShape = (width: number, height: number) => {
    if (width > 0 && height > 0) setAspect(width / height);
  };
  const name = shownName || title || PLAYER_COPY.untitled;

  return (
    // A fixed width (the box, at the clip's shape once it's known), so
    // portrait and landscape clips each keep theirs. The chat bubble's
    // corners, here as in Huddle's tile.
    <div
      className="pulse-video-card relative max-w-full overflow-hidden rounded-2xl bg-neutral-900"
      style={cardBox(aspect, maxSize)}
      // Which video: a page with several cards can be told apart (e2e).
      data-video-id={video}
    >
      <Button
        variant="ghost"
        className="pulse-video-poster group relative block h-full w-full rounded-none p-0 hover:bg-transparent"
        onClick={onOpen}
        disabled={!onOpen}
        data-media-launch-id={launchId}
        aria-label={PLAYER_COPY.play(name)}
      >
        {poster.src === null ? (
          <span className="pulse-video-poster-placeholder block aspect-video w-full" />
        ) : (
          <img
            src={poster.src}
            alt=""
            loading="lazy"
            onError={poster.onError}
            onLoad={(e) => learnShape(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
            className="pulse-video-poster-image block h-full max-h-(--card-size) w-full object-cover"
          />
        )}
        <span
          className="pulse-video-play-icon absolute inset-0 m-auto flex h-14 w-14 items-center justify-center rounded-full bg-black/60 text-white transition-transform group-hover:scale-105"
          aria-hidden="true"
        >
          {/* ▶ points right in either reading direction, so its optical nudge does too. */}
          <FontAwesomeIcon icon={faPlay} className="translate-x-0.5 text-xl" />
        </span>
        {shownName && (
          // Read out as part of the button's label, so hidden from screen
          // readers here. `text-start` follows the reading direction.
          <span
            className="pulse-video-caption pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3 pt-10 pb-2.5 text-start"
            aria-hidden="true"
          >
            <span className="line-clamp-2 text-sm leading-snug font-medium break-words whitespace-normal text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">
              {shownName}
            </span>
          </span>
        )}
      </Button>
      {/* Beside the poster, not inside its Play button: a button in a button
          is neither valid nor reachable. Over the top corner. */}
      <div className="pulse-video-menu absolute end-2 top-2 z-10">
        <VideoMenu
          video={video}
          name={shownName}
          label={name}
          renamable={renamable}
          onRenamed={(renamed) => {
            setShownName(renamed);
            onRenamed?.(renamed);
          }}
          onRemove={onRemove}
        />
      </div>
    </div>
  );
}
