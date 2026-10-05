/**
 * router — Minimal client-side routing primitives.
 *
 * Extracted into its own module so any component can consume RouterContext
 * without creating circular dependencies with AppLayout. The URL scheme these
 * helpers implement is documented in ./ROUTING.md.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export interface RouterCtx {
  pathname: string;
  /** Raw query string of the current route, e.g. "?tab=work" (empty string when none). */
  search: string;
  navigate: (path: string) => void;
  /** Like navigate, but rewrites the current history entry instead of pushing a
   *  new one. Use for view state that Back should not step through (filters). */
  replace: (path: string) => void;
}

export const RouterContext = createContext<RouterCtx>({
  pathname: '/app',
  search: '',
  navigate: () => {},
  replace: () => {},
});

export const useRouter = () => useContext(RouterContext);

// ─── Provider ─────────────────────────────────────────────────────────────────

/**
 * Routes that no longer exist, and where their traffic goes now. Without this
 * an old bookmark or push notification would fall through to the dashboard's
 * default view, silently losing what the link was pointing at.
 *
 *   /app/timesheet → the personal timesheet, now Dashboard → Me → Timesheet
 *   /app/messages, /app/media → withdrawn for MVP; no replacement surface, so
 *     old bookmarks and already-delivered push notifications land on Dashboard
 *     rather than silently rendering it under the wrong URL.
 */
const RETIRED_ROUTES: Record<string, string> = {
  '/app/timesheet': '/app/dashboard?view=timesheet',
  '/app/messages': '/app/dashboard',
  '/app/media': '/app/dashboard',
};

/** Keys from `replacement` win; everything else the original link carried is kept. */
function mergeQuery(original: string, replacement: string): string {
  const params = new URLSearchParams(original);
  for (const [key, value] of new URLSearchParams(replacement)) params.set(key, value);
  return params.toString();
}

/**
 * Collapses repeated slashes and drops a trailing one. A hand-typed or
 * concatenated `//app/timesheet` is a different path to `/app/timesheet`, so
 * it misses RETIRED_ROUTES and the route table; worse,
 * `history.pushState('//app/…')` reads the leading `//` as a protocol-relative
 * URL and throws a cross-origin SecurityError. A trailing slash is the same
 * page to a reader, and the route table is an exact lookup, so `/app/dashboard/`
 * would otherwise be not-found.
 */
function normalizePath(path: string): string {
  const collapsed = path.replace(/\/{2,}/g, '/');
  return collapsed.length > 1 ? collapsed.replace(/\/$/, '') : collapsed;
}

/**
 * Maps a URL onto where it actually lives now: `/app` and `/` mean the
 * dashboard, and a RETIRED_ROUTES path is rewritten to its replacement.
 * Everything else passes through with only its path normalised, query intact.
 */
export function resolveUrl(url: string): string {
  const [rawPath, query = ''] = url.split('?');
  const path = normalizePath(rawPath);

  // The scope (`?team=`, `?org=`) an old link carried has to survive the
  // rewrite, so the replacement's own params are merged over it rather than
  // replacing it wholesale.
  const rewriteTo = (target: string) => {
    const [targetPath, targetQuery = ''] = target.split('?');
    const merged = mergeQuery(query, targetQuery);
    return merged ? `${targetPath}?${merged}` : targetPath;
  };

  if (path === '/app' || path === '/') return rewriteTo('/app/dashboard');
  // Old notification URLs sent the team timesheet to the Teams page; it now
  // lives on the Dashboard's Team tab.
  if (path === '/app/teams' && new URLSearchParams(query).get('tab') === 'timesheet') {
    return rewriteTo('/app/dashboard');
  }
  const retired = RETIRED_ROUTES[path];
  if (retired) return rewriteTo(retired);
  return query ? `${path}?${query}` : path;
}

function splitUrl(url: string): { pathname: string; search: string } {
  const [pathname, query = ''] = url.split('?');
  return { pathname, search: query ? `?${query}` : '' };
}

/** Reads the browser URL, rewriting it in place when it resolves elsewhere. */
function readResolvedLocation(): { pathname: string; search: string } {
  if (typeof window === 'undefined') return { pathname: '/app/dashboard', search: '' };
  const current = window.location.pathname + window.location.search;
  const resolved = resolveUrl(current);
  if (resolved !== current) window.history.replaceState(null, '', resolved);
  return splitUrl(resolved);
}

export const RouterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // `search` is tracked alongside `pathname` so a navigation that only changes
  // the query (e.g. re-tapping a notification for the same profile with a
  // different `?tab=`) still triggers a re-render.
  const [location, setLocation] = useState(readResolvedLocation);

  const navigate = useCallback((path: string) => {
    const target = resolveUrl(path);
    window.history.pushState(null, '', target);
    setLocation(splitUrl(target));
    window.dispatchEvent(new CustomEvent('timehuddle:navigate', { detail: { path: target } }));
  }, []);

  const replace = useCallback((path: string) => {
    const target = resolveUrl(path);
    window.history.replaceState(null, '', target);
    setLocation(splitUrl(target));
  }, []);

  useEffect(() => {
    const onPop = () => setLocation(readResolvedLocation());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const value = useMemo(
    () => ({ pathname: location.pathname, search: location.search, navigate, replace }),
    [location, navigate, replace],
  );

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
};

// ─── Path params ──────────────────────────────────────────────────────────────

/** Whether a nav item for `href` is the current page, detail pages included. */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Matches `pathname` against a pattern such as `/app/tickets/:ticketId`.
 * Returns the decoded params, or null when the path doesn't match exactly.
 * A single trailing slash on the pathname is ignored.
 */
export function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.replace(/\/$/, '').split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const part = patternParts[i];
    if (part.startsWith(':')) {
      try {
        params[part.slice(1)] = decodeURIComponent(pathParts[i]);
      } catch {
        // A broken %-escape is a link to nothing, not a reason to take the app down.
        return null;
      }
    } else if (part !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

// ─── Query params ─────────────────────────────────────────────────────────────

/** `null` or `''` removes the key; anything else sets it. */
export type QueryPatch = Record<string, string | null | undefined>;

/**
 * How a query change is recorded. `replace` for state Back shouldn't step
 * through (typing, filters); `push` for things Back should undo (opening an
 * item, switching a tab).
 */
export type HistoryMode = 'replace' | 'push';

/** Returns `pathname` + `search` with `patch` applied; other keys are kept. */
export function withQuery(pathname: string, search: string, patch: QueryPatch): string {
  const params = new URLSearchParams(search);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === '') params.delete(key);
    else params.set(key, value);
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * The URL as it is right now. Writes build on this rather than on the
 * `search` captured at render: two components patching the query in the same
 * commit (e.g. TeamContext stamping `?team=` while a page restores its
 * filters) would otherwise each start from the stale query and the last write
 * would silently drop the other's change.
 */
export function liveLocation(): { pathname: string; search: string } {
  return { pathname: window.location.pathname, search: window.location.search };
}

export function useQueryParams() {
  const { search, navigate, replace } = useRouter();
  const params = useMemo(() => new URLSearchParams(search), [search]);

  const setParams = useCallback(
    (patch: QueryPatch, mode: HistoryMode = 'replace') => {
      const live = liveLocation();
      const target = withQuery(live.pathname, live.search, patch);
      if (target === live.pathname + live.search) return;
      (mode === 'push' ? navigate : replace)(target);
    },
    [navigate, replace],
  );

  return { params, setParams };
}

/**
 * One query param as `[value, setValue]`. `aliases` are older names still
 * accepted on read (e.g. `postId` for `post`); writing always uses `name` and
 * drops the aliases, so a legacy link is normalised the first time it changes.
 */
export function useQueryParam(
  name: string,
  { aliases = [], mode = 'replace' }: { aliases?: string[]; mode?: HistoryMode } = {},
): [string | null, (value: string | null) => void] {
  const { params, setParams } = useQueryParams();
  const value = [name, ...aliases].map((key) => params.get(key)).find(Boolean) ?? null;

  const aliasKey = aliases.join(',');
  const setValue = useCallback(
    (next: string | null) => {
      const patch: QueryPatch = { [name]: next };
      for (const alias of aliasKey ? aliasKey.split(',') : []) patch[alias] = null;
      setParams(patch, mode);
    },
    [name, aliasKey, mode, setParams],
  );

  return [value, setValue];
}

/**
 * A search box backed by a query param. Returns `[draft, setDraft]` for the
 * input: the page filters on `draft` as the user types, and the URL follows
 * (with `replace`) once typing pauses, so the address bar isn't rewritten on
 * every key. Back/Forward, a reload or a shared link update the draft.
 *
 * `enabled: false` reads as empty and never writes — for a page that stays
 * mounted behind other routes, where the URL's `?q=` isn't its own.
 */
export function useSearchParam(
  name: string,
  { enabled = true, delayMs = 300 }: { enabled?: boolean; delayMs?: number } = {},
): [string, (value: string) => void] {
  const { params, setParams } = useQueryParams();
  const urlValue = enabled ? (params.get(name) ?? '') : '';
  const [draft, setDraft] = useState(urlValue);
  const writtenRef = useRef(urlValue);

  useEffect(() => {
    // A change from outside — not the echo of our own write.
    if (urlValue === writtenRef.current) return;
    writtenRef.current = urlValue;
    setDraft(urlValue);
  }, [urlValue]);

  useEffect(() => {
    if (!enabled || draft === writtenRef.current) return;
    const timer = window.setTimeout(() => {
      writtenRef.current = draft;
      setParams({ [name]: draft });
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [enabled, draft, name, delayMs, setParams]);

  return [draft, setDraft];
}
