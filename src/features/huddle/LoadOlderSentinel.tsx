/**
 * LoadOlderSentinel — the end of the Huddle conversation list.
 *
 * Seen on screen, it asks for the previous window of posts; the list then grows
 * and pushes it back out of view until the reader scrolls to it again. When a
 * list doesn't grow with history (Person, Ticket) the footer stays on screen, so
 * it asks only once until it has been out of view; after that a button loads
 * the next window.
 */
import { Button, Spinner, Text } from '@mieweb/ui';
import { useEffect, useRef, useState } from 'react';

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
  // False after a load this footer asked for, until it has been seen out of view.
  const mayAutoLoadRef = useRef(true);
  const [needsManualLoad, setNeedsManualLoad] = useState(false);
  // A different feed (hasMore unknown again) starts over.
  if (hasMore === null) mayAutoLoadRef.current = true;
  useEffect(() => {
    const anchor = anchorRef.current;
    if (!armed || !anchor) return;
    // A new observer reports the footer's current state straight away.
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) {
        mayAutoLoadRef.current = true;
        setNeedsManualLoad(false);
        return;
      }
      if (!mayAutoLoadRef.current) {
        setNeedsManualLoad(true);
        return;
      }
      mayAutoLoadRef.current = false;
      onVisibleRef.current();
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
      {armed && needsManualLoad && (
        <Button variant="outline" size="sm" onClick={onVisible}>
          Load older posts
        </Button>
      )}
    </div>
  );
}
