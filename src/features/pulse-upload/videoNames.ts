/**
 * What this tab knows each video is called, by video id, and as of when. A
 * Huddle post's card gets its name from the post, but a rename doesn't touch
 * the post (its text is what was posted), so a post copy can carry an older
 * name than the server's. Two things know better, and the newer one wins:
 *
 * - a rename made here, as of when it was saved;
 * - a fetch of posts, as of when it started: the server's names then, which
 *   include any rename saved before it, from this tab or another.
 *
 * So a rename shows at once, and a later fetch takes over from it again. The
 * feed lays these over the names in the posts, and rebuilds when one changes.
 */
import { useSyncExternalStore } from 'react';

const known = new Map<string, { name: string | null; asOf: number }>();
const listeners = new Set<() => void>();
let version = 0;

/** Record videos' names as of `asOf` (ms); older news than what's known is ignored. */
export function noteVideoNames(
  names: Iterable<readonly [videoId: string, name: string | null]>,
  asOf: number,
): void {
  let changed = false;
  for (const [videoId, name] of names) {
    const current = known.get(videoId);
    if (current && current.asOf > asOf) continue;
    if (!current || current.name !== name) changed = true;
    known.set(videoId, { name, asOf });
  }
  if (!changed) return;
  version++;
  for (const listener of listeners) listener();
}

/** Record a rename this tab just saved. */
export function noteRenamed(videoId: string, name: string | null): void {
  noteVideoNames([[videoId, name]], Date.now());
}

/** The name this tab knows for the video, or `undefined` when it knows none. */
export function knownVideoName(videoId: string): string | null | undefined {
  return known.get(videoId)?.name;
}

/** Changes whenever a known name does, for a memo to rebuild on. */
export function useVideoNamesVersion(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
  );
}
