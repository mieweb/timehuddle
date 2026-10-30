/**
 * WatchPage — one video, at `/watch/:videoId`: the page a video's Copy link
 * shares and its ⋯ menu opens, from Huddle, a ticket, a clock session or a
 * walkthrough alike.
 *
 * Mounted by `main.tsx` outside the app shell, like the public release notes:
 * a shared link reaches people who aren't signed in, and playback is public.
 * Who added the video shows only to someone signed in (`videos.publicInfo`).
 *
 * Laid out as Huddle's media view is — it is the same MediaFeed, holding one
 * video: the clip fills the screen at its own shape, upright or sideways, its
 * name (and who added it) float over the top, and the player's controls run
 * along the bottom.
 */
import { ArrowLeftIcon, Button, MediaFeed, ToastProvider } from '@mieweb/ui';
import React, { useCallback, useEffect, useState } from 'react';

import { resolveMediaUrl, videoApi, type VideoPublicInfo } from '@lib/api';
import { Logo } from '../../ui/Logo';
import { ARTIFACT_ID, artifactPath, posterPath, videoLabel } from './artifact';
import { VideoMenu } from './VideoMenu';

/** User-facing copy, kept together for translation. */
const WATCH_COPY = {
  page: 'Video',
  missing: 'This video isn’t available. It may have been removed, or the link may be wrong.',
  back: 'Back',
  home: 'TimeHuddle',
};

/**
 * The video id in a `/watch/:videoId` path, or null for any other path — or
 * one whose id isn't a video's (a PulseVault artifact id), since it becomes a
 * playback URL.
 */
export function watchPathVideoId(pathname: string): string | null {
  const match = /^\/watch\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  let id: string;
  try {
    id = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return ARTIFACT_ID.test(id) ? id.toLowerCase() : null;
}

/** Where the corner button goes: back into the app when that's where you came from. */
function cameFromApp(): boolean {
  try {
    return (
      window.history.length > 1 &&
      !!document.referrer &&
      new URL(document.referrer).origin === window.location.origin
    );
  } catch {
    return false;
  }
}

const cornerButton =
  'absolute start-2 top-2 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm hover:bg-black/65 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none pointer-fine:h-9 pointer-fine:w-9';

export function WatchPage({ videoId }: { videoId: string }) {
  const [info, setInfo] = useState<VideoPublicInfo | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let current = true;
    videoApi.publicInfo(videoId).then(
      (found) => current && setInfo(found),
      () => current && setMissing(true),
    );
    return () => {
      current = false;
    };
  }, [videoId]);

  const name = info?.name ?? null;
  useEffect(() => {
    document.title = `${name ?? WATCH_COPY.page} · TimeHuddle`;
  }, [name]);

  const renamed = useCallback(
    (next: string | null) => setInfo((was) => was && { ...was, name: next }),
    [],
  );
  const back = cameFromApp();

  return (
    <ToastProvider>
      <main className="watch-page h-dvh overflow-hidden bg-black pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] text-white">
        {/* The page's own heading, for screen readers; the name shows over the video. */}
        <h1 className="sr-only">{videoLabel(name, videoId)}</h1>
        {/* Inside the safe areas, so the corner button clears the notch and the
            status bar too: an absolute child ignores its parent's padding. */}
        <div className="watch-page-frame relative h-full">
          {back ? (
            <Button
              variant="ghost"
              size="icon"
              className={`${cornerButton} p-0 hover:text-white`}
              aria-label={WATCH_COPY.back}
              title={WATCH_COPY.back}
              onClick={() => window.history.back()}
            >
              <ArrowLeftIcon className="h-5 w-5 rtl:rotate-180" />
            </Button>
          ) : (
            <a
              href="/app"
              className={cornerButton}
              aria-label={WATCH_COPY.home}
              title={WATCH_COPY.home}
            >
              <Logo size={22} className="rounded-md" />
            </a>
          )}
          <MediaFeed
            className="h-full"
            // As in Huddle's media view: the clip edge to edge under the
            // player's touch-first controls, its name over the top.
            layout="overlay"
            items={[videoId]}
            getId={(id) => id}
            getMedia={(id) => ({
              kind: 'video',
              src: resolveMediaUrl(artifactPath(id)),
              poster: resolveMediaUrl(posterPath(id)),
            })}
            getTitle={(id) => videoLabel(name, id)}
            getAuthor={
              info?.author?.name
                ? () => ({ name: info.author!.name!, avatar: info.author!.image ?? undefined })
                : undefined
            }
            renderActions={(id) => (
              <VideoMenu
                video={id}
                name={name}
                label={videoLabel(name, id)}
                renamable={info?.canRename}
                onRenamed={renamed}
                openable={false}
              />
            )}
            // One video, started by its viewer: no immersive viewer (the
            // player's own full screen is there), no autoplay, no loop, with sound.
            allowFullscreen={false}
            autoPlay={false}
            loop={false}
            muted={false}
            error={missing ? WATCH_COPY.missing : undefined}
            labels={{ feed: WATCH_COPY.page }}
            classNames={{ details: 'ps-14', controls: 'hidden' }}
          />
        </div>
      </main>
    </ToastProvider>
  );
}
