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
import { faPlay } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Button,
  Dropdown,
  DropdownItem,
  MoreHorizontalIcon,
  PencilIcon,
  TrashIcon,
} from '@mieweb/ui';
import React, { useCallback, useEffect, useState } from 'react';

import { resolveMediaUrl } from '@lib/api';
import { artifactPath, posterPath } from './artifact';
import { noteRenamed } from './renamedVideos';
import { VideoRenameDialog } from './VideoRenameDialog';

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

/**
 * A card at its widest, and at its tallest (a portrait clip is as tall as
 * this): never more than half the screen, so a phone — upright or sideways —
 * shows the whole card with room around it. `max-h-[…]` below says the same.
 */
const CARD_WIDTH_REM = 18;
const CARD_MAX_HEIGHT = 'min(28rem, 50dvh)';

/**
 * The card in its video's shape (width ÷ height), once known: as wide as the
 * card allows, narrower for a portrait clip so it isn't taller than the cap.
 * The poster and the player then fill the same box — nothing cropped, no bars.
 */
function cardBox(aspect: number | null): React.CSSProperties | undefined {
  if (!aspect) return undefined;
  return {
    aspectRatio: String(aspect),
    // In rem only: a percentage would resolve against a host that sizes to its
    // content, and shrink the card to the poster's own pixels. `max-w-full`
    // on the card still keeps it inside a narrow host.
    width: `min(${CARD_WIDTH_REM}rem, calc(${CARD_MAX_HEIGHT} * ${aspect}))`,
  };
}

/** The one video playing, so starting another pauses it. */
let playingNow: HTMLVideoElement | null = null;

function playAlone(event: React.SyntheticEvent<HTMLVideoElement>) {
  if (playingNow && playingNow !== event.currentTarget) playingNow.pause();
  playingNow = event.currentTarget;
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
}: PulseVideoPlayerProps) {
  const [playing, setPlaying] = useState(false);
  // The card keeps the name it shows, so a rename here shows at once.
  const [shownName, setShownName] = useState(caption ?? null);
  useEffect(() => setShownName(caption ?? null), [caption]);
  const [renaming, setRenaming] = useState(false);
  // Controlled: the library's menu doesn't close when an item is chosen.
  const [menuOpen, setMenuOpen] = useState(false);
  const choose = (action: () => void) => () => {
    setMenuOpen(false);
    action();
  };
  // No poster (yet), or it failed to load: the same plain box with the ▶.
  const poster = usePoster(video);
  // The shape: from the poster first, then from the video itself once it loads.
  const [aspect, setAspect] = useState<number | null>(null);
  const learnShape = (width: number, height: number) => {
    if (width > 0 && height > 0) setAspect(width / height);
  };
  const name = shownName || title || 'Pulse video';
  // The play button unmounts on click: keep keyboard focus on what replaced it.
  // Played from here, still inside the tap's commit — iOS blocks `autoPlay`
  // with sound once the gesture is over. A card that goes away (navigating
  // off, say) stops its video with it.
  const attachPlayer = useCallback((el: HTMLVideoElement | null) => {
    if (!el) return;
    el.focus();
    void el.play().catch(() => {});
    return () => {
      el.pause();
      if (playingNow === el) playingNow = null;
    };
  }, []);

  return (
    // Fixed width so the card isn't squeezed to the bubble's text width; once
    // the shape is known the card takes it, so portrait and landscape clips
    // each keep theirs, before and after Play.
    <div
      className="pulse-video-card relative my-1 w-72 max-w-full overflow-hidden bg-neutral-900"
      style={cardBox(aspect)}
    >
      {playing ? (
        <video
          ref={attachPlayer}
          className="pulse-video-player block h-full max-h-[min(28rem,50dvh)] w-full bg-black object-contain"
          src={resolveMediaUrl(artifactPath(video))}
          poster={poster.src ?? undefined}
          controls
          playsInline
          onPlay={playAlone}
          onLoadedMetadata={(e) =>
            learnShape(e.currentTarget.videoWidth, e.currentTarget.videoHeight)
          }
          aria-label={name}
        />
      ) : (
        <Button
          variant="ghost"
          className="pulse-video-poster group relative block h-full w-full rounded-none p-0 hover:bg-transparent"
          onClick={() => setPlaying(true)}
          aria-label={`Play ${name}`}
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
              className="pulse-video-poster-image block h-full max-h-[min(28rem,50dvh)] w-full object-cover"
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
      )}
      {(renamable || onRemove) && (
        // Beside the poster, not inside its Play button: a button in a button
        // is neither valid nor reachable. Over the top corner, before and
        // after Play, clear of the player's own controls along the bottom;
        // a thumb-sized 40px on a touch screen. The library's Button sets its
        // icon inline on a text line, 1.3px low; as a block it's dead centre.
        <div className="pulse-video-menu absolute end-2 top-2 z-10">
          <Dropdown
            open={menuOpen}
            onOpenChange={setMenuOpen}
            placement="bottom-end"
            trigger={
              <Button
                variant="ghost"
                size="icon"
                aria-label={`More for ${name}`}
                className="h-8 w-8 rounded-full bg-black/55 pointer-coarse:h-10 pointer-coarse:w-10 [&_svg]:block! text-white shadow-sm backdrop-blur-sm hover:bg-black/75 hover:text-white focus-visible:ring-2 focus-visible:ring-white"
              >
                <MoreHorizontalIcon className="h-4 w-4" />
              </Button>
            }
          >
            {renamable && (
              <DropdownItem
                icon={<PencilIcon className="h-4 w-4" />}
                onClick={choose(() => setRenaming(true))}
              >
                {shownName ? 'Rename' : 'Add a name'}
              </DropdownItem>
            )}
            {onRemove && (
              <DropdownItem
                variant="danger"
                icon={<TrashIcon className="h-4 w-4" />}
                onClick={choose(onRemove)}
              >
                Remove
              </DropdownItem>
            )}
          </Dropdown>
        </div>
      )}
      {renamable && (
        <VideoRenameDialog
          videoId={renaming ? video : null}
          name={shownName}
          onClose={() => setRenaming(false)}
          onRenamed={(renamed) => {
            setShownName(renamed);
            noteRenamed(video, renamed);
            onRenamed?.(renamed);
          }}
        />
      )}
    </div>
  );
}
