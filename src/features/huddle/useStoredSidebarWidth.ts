import { useCallback, useState } from 'react';

const SIDEBAR_WIDTH_KEY = 'app:huddleSidebarWidth';

const widthKey = (userId: string) => `${SIDEBAR_WIDTH_KEY}:${userId}`;

function loadStoredWidth(userId: string | undefined): number | undefined {
  if (!userId) return undefined;
  try {
    const stored = Number(localStorage.getItem(widthKey(userId)));
    return stored > 0 ? stored : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The Huddle conversation list's width, kept in this browser per user across
 * reloads, so accounts sharing a browser don't overwrite each other's width.
 * `undefined` until the reader first resizes it, so the inbox uses its default.
 * The inbox clamps the value, so a stale or edited one can't break the layout.
 */
export function useStoredSidebarWidth(userId: string | undefined) {
  const [state, setState] = useState(() => ({ userId, width: loadStoredWidth(userId) }));
  // The account changed without a remount: load that account's width.
  if (state.userId !== userId) {
    setState({ userId, width: loadStoredWidth(userId) });
  }

  const saveWidth = useCallback(
    (next: number) => {
      setState({ userId, width: next });
      if (!userId) return;
      try {
        localStorage.setItem(widthKey(userId), String(next));
      } catch {
        // Storage may be unavailable (private mode, embedded webview) — the
        // width still applies for this session.
      }
    },
    [userId],
  );
  return [state.userId === userId ? state.width : undefined, saveWidth] as const;
}
