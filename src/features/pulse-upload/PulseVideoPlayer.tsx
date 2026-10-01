/**
 * PulseVideoPlayer — how a Pulse video shows anywhere in the app (Huddle posts,
 * ticket and clock-session attachments): its poster frame with a play button,
 * swapped for an inline player on click.
 *
 * Takes PulseVault artifact **ids**, never URLs, and builds every URL itself,
 * so it can only ever point at this backend's `/pulsevault/artifacts` route.
 *
 * Loads nothing until played: the poster is a plain image, and `<video>` only
 * mounts after the click, so a long list of videos costs one image each.
 */
import { faPlay } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button } from '@mieweb/ui';
import React, { useState } from 'react';

import { resolveMediaUrl } from '@lib/api';
import { artifactPath, type PulseVideoProps } from '../huddle/pulseVideoBlock';

export function PulseVideoPlayer({ video, poster }: PulseVideoProps) {
  const [playing, setPlaying] = useState(false);
  // A poster that fails to load (missing file) would collapse the card to
  // nothing, so fall back to the same plain box as a video without one.
  const [posterFailed, setPosterFailed] = useState(false);
  const videoUrl = resolveMediaUrl(artifactPath(video));
  const posterUrl = poster ? resolveMediaUrl(artifactPath(poster)) : undefined;

  return (
    // Fixed width so the card isn't squeezed to the bubble's text width; the
    // height follows the poster, so vertical Pulse clips keep their shape.
    <div className="pulse-video-card relative my-1 w-72 max-w-full overflow-hidden rounded-xl bg-neutral-900">
      {playing ? (
        <video
          className="pulse-video-player block max-h-[28rem] w-full bg-black object-contain"
          src={videoUrl}
          poster={posterUrl}
          controls
          autoPlay
          playsInline
          aria-label="Pulse video"
        />
      ) : (
        <Button
          variant="ghost"
          className="pulse-video-poster group relative block h-auto w-full rounded-none p-0 hover:bg-transparent"
          onClick={() => setPlaying(true)}
          aria-label="Play Pulse video"
        >
          {posterUrl && !posterFailed ? (
            <img
              src={posterUrl}
              alt=""
              loading="lazy"
              onError={() => setPosterFailed(true)}
              className="pulse-video-poster-image block max-h-[28rem] w-full object-cover"
            />
          ) : (
            <span className="pulse-video-poster-placeholder block aspect-video w-full" />
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
