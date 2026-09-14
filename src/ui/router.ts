/**
 * router — Minimal client-side routing primitives.
 *
 * Extracted into its own module so any component can consume RouterContext
 * without creating circular dependencies with AppLayout.
 */
import { createContext, useContext } from 'react';

export interface RouterCtx {
  pathname: string;
  /** Raw query string of the current route, e.g. "?tab=work" (empty string when none). */
  search: string;
  navigate: (path: string) => void;
  /** Like navigate, but rewrites the current history entry instead of pushing a
   *  new one. Use to strip consumed deep-link query params. */
  replace: (path: string) => void;
}

export const RouterContext = createContext<RouterCtx>({
  pathname: '/app',
  search: '',
  navigate: () => {},
  replace: () => {},
});

export const useRouter = () => useContext(RouterContext);
