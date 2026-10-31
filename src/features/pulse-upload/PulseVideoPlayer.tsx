/**
 * PulseVideoPlayer — how a Pulse video shows anywhere in the app (Huddle posts,
 * ticket and clock-session attachments): its poster frame with a play button,
 * swapped for an inline player on click.
 *
 * Takes the PulseVault artifact **id**, never a URL, and builds every URL
 * itself (see artifact.ts), so it can only ever point at this backend. The
 * poster is looked up by the video's id, so it shows whichever order Pulse
 * uploaded the two in.
 *
 * Loads nothing until played: the poster is a plain image, and `<video>` only
 * mounts after the click, so a long list of videos costs one image each.
 */
import { faExpand, faPlay } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, MediaPlayer } from '@mieweb/ui';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { resolveMediaUrl } from '@lib/api';
import { artifactPath, posterPath } from './artifact';
import { CORNER_BUTTON, VideoMenu } from './VideoMenu';
import { VideoNameEditor } from './VideoNameEditor';

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
  expand: (video: string) => `Open ${video} larger`,
};

/**
 * A video card's box, both ways, as a CSS length: a wide clip up to this wide,
 * an upright one up to this tall, and at most 40% of a short screen. Huddle
 * gives SuperChat the same (`mediaMaxSize`), so its cards match.
 */
export const VIDEO_CARD_SIZE = 'min(16rem, 40dvh)';

/**
 * The card's box: its shape (width ÷ height) once known, so the poster and the
 * player fill the same box — nothing cropped, no bars — and its width: `size`,
 * or narrower for an upright clip so it isn't taller than `size`. The same
 * however long the message. Not a percentage: the message sizes itself to the
 * card, and `max-w-full` on the card still fits it, shape and all, inside a
 * narrower one. `--card-size` gives the poster and player their height cap.
 */
function cardBox(aspect: number | null, size: string): React.CSSProperties {
  return {
    ['--card-size' as string]: size,
    ...(aspect
      ? { aspectRatio: String(aspect), width: `min(${size}, calc(${size} * ${aspect}))` }
      : { width: size }),
  };
}

/** The one video playing, so starting another pauses it. */
let playingNow: HTMLVideoElement | null = null;

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
   * Where the host has a larger view (Huddle's media view): an expand button
   * in the card's top corner opens it. ▶ still plays it in the card.
   */
  onOpen?: () => void;
  /** Marks the expand button for the host to return focus to (SuperChat's `data-media-launch-id`). */
  launchId?: string;
  /** The card's box (SuperChat's `maxSize` in Huddle). @default VIDEO_CARD_SIZE */
  maxSize?: string;
}

/**
 * Keyed by the video: a host that swaps the video under it (the approvals
 * window moving to the next request) gets a fresh card — a Play button, and
 * its own looks for the poster — not the last video's state.
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
  const [playing, setPlaying] = useState(false);
  // Its name is being edited in place (VideoNameEditor).
  const [editing, setEditing] = useState(false);
  // The card keeps the name it shows, so a rename here shows at once.
  const [shownName, setShownName] = useState(caption ?? null);
  useEffect(() => setShownName(caption ?? null), [caption]);
  // No poster (yet), or it failed to load: the same plain box with the ▶.
  const poster = usePoster(video);
  // The shape: from the poster first, then from the video itself once it loads.
  const [aspect, setAspect] = useState<number | null>(null);
  const learnShape = (width: number, height: number) => {
    if (width > 0 && height > 0) setAspect(width / height);
  };
  const name = shownName || title || PLAYER_COPY.untitled;
  // The library's player with its touch-first controls, as in the media view.
  const cardRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  // Played from here, still inside the tap's commit — iOS blocks autoplay with
  // sound once the gesture is over — and keyboard focus kept on what replaced
  // the play button (the controls' Pause). One video plays at a time; a card
  // that goes away (navigating off, say) stops its video with it.
  useLayoutEffect(() => {
    const el = videoRef.current;
    if (!playing || !(el instanceof HTMLVideoElement)) return;
    const onPlay = () => {
      if (playingNow && playingNow !== el) playingNow.pause();
      playingNow = el;
    };
    const onMetadata = () => {
      if (el.videoWidth > 0 && el.videoHeight > 0) setAspect(el.videoWidth / el.videoHeight);
    };
    el.addEventListener('play', onPlay);
    el.addEventListener('loadedmetadata', onMetadata);
    cardRef.current
      ?.querySelector<HTMLButtonElement>('[data-slot="media-controls-bar"] button')
      ?.focus();
    void el.play().catch(() => {});
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('loadedmetadata', onMetadata);
      el.pause();
      if (playingNow === el) playingNow = null;
    };
  }, [playing]);

  return (
    // A fixed width (the box, at the clip's shape once it's known), so
    // portrait and landscape clips each keep theirs, before and after Play.
    // The chat bubble's corners, here as in Huddle's tile.
    <div
      ref={cardRef}
      className="pulse-video-card relative max-w-full overflow-hidden rounded-2xl bg-neutral-900"
      // Playing before its shape is known (no poster): 16:9 until the clip
      // says, so the player has a box to fill.
      style={cardBox(aspect ?? (playing ? 16 / 9 : null), maxSize)}
    >
      {playing ? (
        <MediaPlayer
          src={resolveMediaUrl(artifactPath(video))}
          kind="video"
          controlsStyle="overlay"
          poster={poster.src ?? undefined}
          preload="metadata"
          mediaElementRef={videoRef}
          aria-label={name}
          // Its own box goes full screen, so the card's cap only applies here.
          className="pulse-video-player max-h-(--card-size)"
        />
      ) : (
        <Button
          variant="ghost"
          className="pulse-video-poster group relative block h-full w-full rounded-none p-0 hover:bg-transparent"
          onClick={() => setPlaying(true)}
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
              onLoad={(e) =>
                learnShape(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)
              }
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
          {shownName && !renamable && (
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
      )}
      {renamable && (!playing || editing) && (
        // The owner's name is its editor (InlineEdit): click it, or ⋯ →
        // Rename. Over the poster's foot, where the name shows, or over the
        // top while it plays, clear of the player's controls.
        <VideoNameEditor
          video={video}
          name={shownName}
          editing={editing}
          onEditingChange={setEditing}
          onRenamed={(renamed) => {
            setShownName(renamed);
            onRenamed?.(renamed);
          }}
          className={`pulse-video-name absolute inset-x-0 z-20 p-1.5 ${
            playing
              ? 'top-0 bg-black/75'
              : 'bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent pt-8'
          }`}
        />
      )}
      {onOpen && !playing && !editing && (
        // Opposite the menu: the host's larger view, from the poster. Not
        // while it plays, where the player's own full screen is beside it.
        <div className="pulse-video-expand absolute start-2 top-2 z-10 in-[:fullscreen]:hidden">
          <Button
            variant="ghost"
            size="icon"
            data-media-launch-id={launchId}
            aria-label={PLAYER_COPY.expand(name)}
            onClick={onOpen}
            className={CORNER_BUTTON}
          >
            <FontAwesomeIcon icon={faExpand} className="text-base" />
          </Button>
        </div>
      )}
      {!editing && (
        // Beside the poster, not inside its Play button: a button in a button
        // is neither valid nor reachable. Over the top corner, before and
        // after Play, clear of the player's own controls along the bottom.
        <div className="pulse-video-menu absolute end-2 top-2 z-10 in-[:fullscreen]:hidden">
          <VideoMenu
            video={video}
            name={shownName}
            label={name}
            onRename={renamable ? () => setEditing(true) : undefined}
            onRemove={onRemove}
          />
        </div>
      )}
    </div>
  );
}
