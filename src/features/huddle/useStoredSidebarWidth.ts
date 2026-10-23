import { useCallback, useState } from 'react';

const SIDEBAR_WIDTH_KEY = 'app:huddleSidebarWidth';

function loadStoredWidth(): number | undefined {
  try {
    const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    return stored > 0 ? stored : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The Huddle conversation list's width, kept in this browser across reloads.
 * `undefined` until the reader first resizes it, so the inbox uses its default.
 * The inbox clamps the value, so a stale or edited one can't break the layout.
 */
export function useStoredSidebarWidth() {
  const [width, setWidth] = useState<number | undefined>(loadStoredWidth);
  const saveWidth = useCallback((next: number) => {
    setWidth(next);
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next));
    } catch {
      // Storage may be unavailable (private mode, embedded webview) — the
      // width still applies for this session.
    }
  }, []);
  return [width, saveWidth] as const;
}
