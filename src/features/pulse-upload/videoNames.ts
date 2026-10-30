/**
 * Videos renamed in this tab, by video id. A Huddle post's card gets its name
 * from the post, and a rename doesn't touch the post (its text is what was
 * posted), so the live feed would go on showing the old name until the post
 * itself changed. The feed lays these over the names it was sent, and
 * rebuilds when one changes.
 */
import { useSyncExternalStore } from 'react';

const renamed = new Map<string, string | null>();
const listeners = new Set<() => void>();
let version = 0;

/** Record a rename this tab made, and tell anyone building cards from posts. */
export function noteRenamed(videoId: string, name: string | null): void {
  renamed.set(videoId, name);
  version++;
  for (const listener of listeners) listener();
}

/** The name this tab gave the video, or `undefined` when it hasn't renamed it. */
export function renamedName(videoId: string): string | null | undefined {
  return renamed.has(videoId) ? (renamed.get(videoId) ?? null) : undefined;
}

/** Changes whenever a video is renamed in this tab, for a memo to rebuild on. */
export function useRenamedVideosVersion(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
  );
}
