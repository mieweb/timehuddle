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
import { Button } from '@mieweb/ui';
import React, { useCallback, useEffect, useState } from 'react';

import { resolveMediaUrl } from '@lib/api';
import { artifactPath, posterPath } from './artifact';

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
function usePoster(video: string): { src: string | null; onError: () => void } {
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
}

/**
 * Keyed by the video: a host that swaps the video under it (the approvals
 * window moving to the next request) gets a fresh card — a Play button, and
 * its own looks for the poster — not the last video's state.
 */
export function PulseVideoPlayer(props: PulseVideoPlayerProps) {
  return <PulseVideoCard key={props.video} {...props} />;
}

function PulseVideoCard({ video, title }: PulseVideoPlayerProps) {
  const [playing, setPlaying] = useState(false);
  // No poster (yet), or it failed to load: the same plain box with the ▶.
  const poster = usePoster(video);
  const name = title || 'Pulse video';
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
    // Fixed width so the card isn't squeezed to the bubble's text width; the
    // height follows the poster, so vertical Pulse clips keep their shape.
    <div className="pulse-video-card relative my-1 w-72 max-w-full overflow-hidden rounded-xl bg-neutral-900">
      {playing ? (
        <video
          ref={attachPlayer}
          className="pulse-video-player block max-h-[28rem] w-full bg-black object-contain"
          src={resolveMediaUrl(artifactPath(video))}
          poster={poster.src ?? undefined}
          controls
          playsInline
          onPlay={playAlone}
          aria-label={name}
        />
      ) : (
        <Button
          variant="ghost"
          className="pulse-video-poster group relative block h-auto w-full rounded-none p-0 hover:bg-transparent"
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
              className="pulse-video-poster-image block max-h-[28rem] w-full object-cover"
            />
          )}
          <span
            className="pulse-video-play-icon absolute inset-0 m-auto flex h-14 w-14 items-center justify-center rounded-full bg-black/60 text-white transition-transform group-hover:scale-105"
            aria-hidden="true"
          >
            {/* ▶ points right in either reading direction, so its optical nudge does too. */}
            <FontAwesomeIcon icon={faPlay} className="translate-x-0.5 text-xl" />
          </span>
        </Button>
      )}
    </div>
  );
}
