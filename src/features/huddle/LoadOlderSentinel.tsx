/**
 * LoadOlderSentinel — the end of the Huddle conversation list.
 *
 * Seen on screen, it asks for the previous window of posts; the list then grows
 * and pushes it back out of view until the reader scrolls to it again. It
 * re-observes after every load, so a window that didn't fill the list triggers
 * the next one on its own.
 */
import { Button, Spinner, Text } from '@mieweb/ui';
import { useEffect, useRef } from 'react';

interface LoadOlderSentinelProps {
  /** Older posts exist beyond the loaded window; null while that isn't known yet. */
  hasMore: boolean | null;
  loading: boolean;
  /** The last load failed; loading waits for an explicit retry. */
  failed: boolean;
  onVisible: () => void;
  onRetry: () => void;
}

export function LoadOlderSentinel({
  hasMore,
  loading,
  failed,
  onVisible,
  onRetry,
}: LoadOlderSentinelProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const onVisibleRef = useRef(onVisible);
  onVisibleRef.current = onVisible;

  const armed = hasMore === true && !loading && !failed;
  useEffect(() => {
    const anchor = anchorRef.current;
    if (!armed || !anchor) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onVisibleRef.current();
    });
    observer.observe(anchor);
    return () => observer.disconnect();
  }, [armed]);

  return (
    <div
      ref={anchorRef}
      className="huddle-load-older flex min-h-12 items-center justify-center gap-2 px-2 py-3"
    >
      <div aria-live="polite" className="flex items-center gap-2">
        {loading && (
          <>
            <Spinner size="sm" label="Loading older posts" />
            <Text as="span" variant="muted" size="xs">
              Loading older posts…
            </Text>
          </>
        )}
        {hasMore === false && !loading && (
          <Text as="span" variant="muted" size="xs">
            No older posts
          </Text>
        )}
        {failed && (
          <Text as="span" variant="muted" size="xs">
            Couldn’t load older posts.
          </Text>
        )}
      </div>
      {failed && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
