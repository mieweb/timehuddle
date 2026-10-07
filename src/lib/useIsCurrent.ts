/**
 * useIsCurrent — ask whether a value captured earlier is still the current one.
 *
 * A save or delete keeps the refresh function it was given when it began. On a
 * page kept mounted behind others (src/ui/ROUTING.md) it can finish after the
 * user left and came back on another team, member or week, and that refresh
 * would then load the old selection as the newest request, replacing the one
 * on screen. A load checks its own scope with this first and does nothing when
 * it is stale; the current selection has its own load.
 */
import { useCallback, useRef } from 'react';

export function useIsCurrent<T>(value: T): (candidate: T) => boolean {
  const current = useRef(value);
  current.current = value;
  return useCallback((candidate: T) => Object.is(candidate, current.current), []);
}
