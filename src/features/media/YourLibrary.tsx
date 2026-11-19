/**
 * "Your library", below Unsent videos on the Media page (PLAN §5.1): what
 * `media.list` holds, the person's library items and the Pulse videos kept
 * there because their place was gone (each says why). Ticket, session and
 * post videos live on those places, not here.
 *
 * Presentational: the page reads the list and passes it in.
 */
import { Alert, Button, Spinner, Text } from '@mieweb/ui';
import { Film } from 'lucide-react';
import { useId } from 'react';

import type { MediaItem } from '../../lib/api';
import { MEDIA_TEXT } from './mediaStrings';

const T = MEDIA_TEXT.library;

export interface YourLibraryProps {
  items: readonly MediaItem[];
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Watch a video (its page). */
  onWatch: (item: MediaItem) => void;
}

/** The library's videos, newest first. */
export function libraryVideos(items: readonly MediaItem[]): MediaItem[] {
  return items
    .filter((item) => item.type === 'video')
    .sort((a, b) => Date.parse(b.uploadedAt) - Date.parse(a.uploadedAt));
}

export function YourLibrary({
  items,
  loading = false,
  error = null,
  onRetry,
  onWatch,
}: YourLibraryProps) {
  const headingId = useId();
  const videos = libraryVideos(items);

  let body;
  if (loading && videos.length === 0) {
    body = (
      <div className="your-library-loading flex justify-center py-6" aria-busy="true">
        <Spinner size="sm" label={T.loading} />
      </div>
    );
  } else if (error && videos.length === 0) {
    body = (
      <Alert variant="danger" className="your-library-error">
        <span>{T.loadFailed}</span>{' '}
        {onRetry && (
          <Button variant="link" size="sm" className="h-auto p-0" onClick={onRetry}>
            {T.retry}
          </Button>
        )}
      </Alert>
    );
  } else if (videos.length === 0) {
    body = (
      <Text size="sm" variant="muted" className="your-library-empty">
        {T.empty}
      </Text>
    );
  } else {
    body = (
      <ul className="your-library-items flex flex-col gap-3" aria-label={T.listLabel}>
        {videos.map((item) => {
          const name = item.title || T.untitled;
          return (
            <li key={item.id} className="your-library-item flex items-center gap-3">
              <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                {item.thumbnail ? (
                  <img src={item.thumbnail} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Film className="size-5 text-muted-foreground" aria-hidden />
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto max-w-full p-0 text-start"
                  aria-label={T.open(name)}
                  onClick={() => onWatch(item)}
                >
                  {name}
                </Button>
                {item.keptReason && (
                  <span className="your-library-kept text-xs text-muted-foreground">
                    {T.kept(item.keptReason)}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section className="your-library flex flex-col gap-3" aria-labelledby={headingId}>
      <h2 id={headingId} className="your-library-heading text-base font-semibold">
        {T.heading}
      </h2>
      {body}
    </section>
  );
}
