/**
 * Live updates for the usage report, over DDP.
 *
 * The report is a method call (its numbers are aggregations, not documents a
 * subscription could carry), so this hook subscribes to `usage.live` — a
 * signal the server moves whenever something the report shows changes — and
 * asks the page to refetch, at most once per LIVE_REFETCH_MIN_INTERVAL_MS.
 */
import { useEffect, useRef } from 'react';

import { getDdpClient } from '../../lib/ddp';

/** How long to let a burst of changes (clocking in also starts a session) settle
 *  before refetching, so one action costs one report. */
export const LIVE_REFETCH_DELAY_MS = 1_000;

/** The fewest milliseconds between two live refetches. Each one reruns the
 *  whole 30-day report, so a busy morning — many people clocking in and posting
 *  at once — costs at most one report per this interval per open page. */
export const LIVE_REFETCH_MIN_INTERVAL_MS = 5_000;

/**
 * Call `onChange` whenever the server signals that something the report shows
 * has changed — someone comes online or goes offline, clocks in or out, or
 * does something the report counts. See `usage.live` in meteor-backend.
 *
 * Refetches never overlap: while one is in flight (`onChange`'s promise is
 * pending), further changes queue a single follow-up instead of starting
 * another. Otherwise, with a report slower than the interval, each request
 * would supersede the last before it landed and the page would never update.
 */
export function useUsageLiveUpdates(
  orgId: string | undefined,
  enabled: boolean,
  onChange: () => void | Promise<unknown>,
) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!enabled) return;
    const ddp = getDdpClient();
    let ready = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastRefetchAt = 0;
    let inFlight = false;
    let changedDuringFetch = false;
    let disposed = false;
    /** Refetch soon, but no sooner than the interval allows. A refetch already
     *  scheduled picks up any further change too; one in flight is followed by
     *  one more when it lands. */
    const scheduleRefetch = () => {
      if (inFlight) {
        changedDuringFetch = true;
        return;
      }
      if (timer) return;
      const wait = Math.max(
        LIVE_REFETCH_DELAY_MS,
        lastRefetchAt + LIVE_REFETCH_MIN_INTERVAL_MS - Date.now(),
      );
      timer = setTimeout(async () => {
        timer = undefined;
        lastRefetchAt = Date.now();
        inFlight = true;
        try {
          await onChangeRef.current();
        } catch {
          // The page reports its own load errors; a failed refetch must not
          // stop the next one.
        } finally {
          inFlight = false;
          if (changedDuringFetch && !disposed) {
            changedDuringFetch = false;
            scheduleRefetch();
          }
        }
      }, wait);
    };
    const offChange = ddp.onCollectionChange('usageLive', () => {
      // The signal document arrives once before `ready`; the refetch on ready
      // below covers it.
      if (ready) scheduleRefetch();
    });
    const unsubscribe = ddp.subscribe('usage.live', [orgId ? { orgId } : {}], () => {
      ready = true;
      // The page fetched its report independently of this subscription, so a
      // change between that fetch and now reached neither. Refetch once to
      // close the gap (and again after a reconnect, which re-readies the sub).
      scheduleRefetch();
    });
    return () => {
      disposed = true;
      clearTimeout(timer);
      offChange();
      unsubscribe();
    };
  }, [orgId, enabled]);
}
