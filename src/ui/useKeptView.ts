/**
 * useKeptView — bring back a kept page's view when the user returns to it.
 *
 * A page kept mounted behind others (see ROUTING.md) keeps its state, but its
 * view lives in the URL, and the sidebar link back to it is a bare path. So
 * remember the view while the page is on screen, and put it back when the page
 * is shown again at a URL that names none of it. A URL that names any of
 * `linkKeys` (a notification, a shared link) is asking for a view, and wins.
 *
 * The layout effect runs before paint, so a return never flashes the default
 * view, and it re-runs each time <Activity> shows the page again.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';

import { useQueryParams } from './router';

export function useKeptView(
  /** True while this page is the one on screen. */
  onScreen: boolean,
  /** The view to remember: param name → value, null for absent. */
  view: Record<string, string | null>,
  /** Params whose presence means the URL asks for a view. Defaults to `view`'s. */
  linkKeys: readonly string[] = Object.keys(view),
): void {
  const { params, setParams } = useQueryParams();
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const linkKeysRef = useRef(linkKeys);
  linkKeysRef.current = linkKeys;

  const lastViewRef = useRef<Record<string, string | null>>({});
  useLayoutEffect(() => {
    if (linkKeysRef.current.some((key) => paramsRef.current.has(key))) return;
    setParams(lastViewRef.current);
  }, [setParams]);

  // Compared by content: callers build `view` fresh on every render.
  const viewKey = JSON.stringify(view);
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    if (onScreen) lastViewRef.current = viewRef.current;
  }, [onScreen, viewKey]);
}
