/**
 * Ask the Huddle feed to re-read over REST after a write made elsewhere in the
 * app (a timer started, today's plan changed) posted to it. The live
 * subscription may not deliver it: a phone can have no DDP socket at all.
 *
 * Huddle pauses its effects while another page shows, so a request made then
 * is kept and served the moment it resumes.
 */
import { useEffect, useRef } from 'react';

const HUDDLE_REFETCH = 'huddle:refetch';
let pending = false;

export function requestHuddleRefresh(): void {
  pending = true;
  window.dispatchEvent(new CustomEvent(HUDDLE_REFETCH));
}

/** Runs `refresh` for each request, and once on mount for one made while away. */
export function useHuddleRefreshRequests(refresh: () => unknown): void {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    const serve = () => {
      pending = false;
      void refreshRef.current();
    };
    if (pending) serve();
    window.addEventListener(HUDDLE_REFETCH, serve);
    return () => window.removeEventListener(HUDDLE_REFETCH, serve);
  }, []);
}
