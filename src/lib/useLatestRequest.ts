/**
 * useLatestRequest — let only the newest of overlapping loads write.
 *
 * A page kept mounted behind others (src/ui/ROUTING.md) can leave a load in
 * flight when it is hidden, then start another on return, possibly for a
 * different team, org or week. Whichever answers last would otherwise win, so
 * an old scope's data could replace the new one's.
 *
 * Call `begin()` at the start of each load, and check the function it returns
 * before every write, error and loading update. Starting a load, including
 * one that bails out early (no team selected), retires every earlier one.
 */
import { useCallback, useRef } from 'react';

export function useLatestRequest(): () => () => boolean {
  const latest = useRef(0);
  return useCallback(() => {
    const id = ++latest.current;
    return () => id === latest.current;
  }, []);
}
