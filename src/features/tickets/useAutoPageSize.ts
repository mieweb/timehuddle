/**
 * Fits the ticket table to the height it has, instead of scrolling it.
 *
 * Measures the actual rendered header and row heights — rather than guessing
 * them — and reports how many rows fit, so pagination shows a full screen of
 * rows on a large display, fewer on a short one, and never clips the last row.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** Used only before a real header/row exists to measure. */
const FALLBACK_HEADER_HEIGHT = 48;
const FALLBACK_ROW_HEIGHT = 57;
/** Enough rows to stay useful on a short viewport or mid-resize. */
const MIN_ROWS = 3;

export function useAutoPageSize(): {
  containerRef: React.RefObject<HTMLDivElement | null>;
  pageSize: number;
} {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [pageSize, setPageSize] = useState(MIN_ROWS);

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    const header = el.querySelector('thead');
    // Skeleton rows carry no `data-ticket-id`, so a loading placeholder's
    // shorter height is never mistaken for a real row's.
    const row = el.querySelector<HTMLElement>('tbody tr[data-ticket-id]');
    const headerHeight = header?.getBoundingClientRect().height || FALLBACK_HEADER_HEIGHT;
    const rowHeight = row?.getBoundingClientRect().height || FALLBACK_ROW_HEIGHT;

    const available = el.clientHeight - headerHeight;
    setPageSize(Math.max(MIN_ROWS, Math.floor(available / rowHeight)));
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    measure();

    // The container's own size changes (window resize, filter bar wrapping,
    // the create form opening) fire here.
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(el);

    // Re-measure once real rows replace the loading skeleton, or a page/filter
    // change swaps the row set — a stale measurement is what let the last row
    // run past the container before.
    const mutationObserver = new MutationObserver(measure);
    mutationObserver.observe(el, { childList: true, subtree: true });

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [measure]);

  return { containerRef, pageSize };
}
