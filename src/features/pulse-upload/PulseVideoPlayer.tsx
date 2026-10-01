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
import React, { useCallback, useState } from 'react';

import { resolveMediaUrl } from '@lib/api';
import { artifactPath, posterPath } from './artifact';

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

export function PulseVideoPlayer({ video, title }: PulseVideoPlayerProps) {
  const [playing, setPlaying] = useState(false);
  // No poster (yet), or it failed to load: the same plain box with the ▶.
  const [posterFailed, setPosterFailed] = useState(false);
  const name = title || 'Pulse video';
  // The play button unmounts on click; keep keyboard focus on what replaced it.
  const focusOnMount = useCallback((el: HTMLVideoElement | null) => el?.focus(), []);

  return (
    // Fixed width so the card isn't squeezed to the bubble's text width; the
    // height follows the poster, so vertical Pulse clips keep their shape.
    <div className="pulse-video-card relative my-1 w-72 max-w-full overflow-hidden rounded-xl bg-neutral-900">
      {playing ? (
        <video
          ref={focusOnMount}
          className="pulse-video-player block max-h-[28rem] w-full bg-black object-contain"
          src={resolveMediaUrl(artifactPath(video))}
          poster={posterFailed ? undefined : resolveMediaUrl(posterPath(video))}
          controls
          autoPlay
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
          {posterFailed ? (
            <span className="pulse-video-poster-placeholder block aspect-video w-full" />
          ) : (
            <img
              src={resolveMediaUrl(posterPath(video))}
              alt=""
              loading="lazy"
              onError={() => setPosterFailed(true)}
              className="pulse-video-poster-image block max-h-[28rem] w-full object-cover"
            />
          )}
          <span
            className="pulse-video-play-icon absolute top-1/2 left-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white transition-transform group-hover:scale-105"
            aria-hidden="true"
          >
            <FontAwesomeIcon icon={faPlay} className="ml-1 text-xl" />
          </span>
        </Button>
      )}
    </div>
  );
}
