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
 */
export function useUsageLiveUpdates(
  orgId: string | undefined,
  enabled: boolean,
  onChange: () => void,
) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!enabled) return;
    const ddp = getDdpClient();
    let ready = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastRefetchAt = 0;
    const offChange = ddp.onCollectionChange('usageLive', () => {
      // The signal document arrives once before `ready`; that is the state the
      // report was just fetched in, not a change to it.
      // A refetch already scheduled will pick this change up too.
      if (!ready || timer) return;
      const wait = Math.max(
        LIVE_REFETCH_DELAY_MS,
        lastRefetchAt + LIVE_REFETCH_MIN_INTERVAL_MS - Date.now(),
      );
      timer = setTimeout(() => {
        timer = undefined;
        lastRefetchAt = Date.now();
        onChangeRef.current();
      }, wait);
    });
    const unsubscribe = ddp.subscribe('usage.live', [orgId ? { orgId } : {}], () => {
      ready = true;
    });
    return () => {
      clearTimeout(timer);
      offChange();
      unsubscribe();
    };
  }, [orgId, enabled]);
}
