/**
 * RefreshContext - Coordinates pull-to-refresh across pages.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef } from 'react';

import { withTimeout } from './withTimeout';

type RefreshHandler = () => Promise<void> | void;

/** A failing or hung handler must never strand the pull-to-refresh spinner past this. */
export const REFRESH_TIMEOUT_MS = 10_000;

/** 'ok' = every page handler settled; 'failed' = one rejected; 'timeout' = the bound above was hit. */
export type RefreshOutcome = 'ok' | 'failed' | 'timeout';

interface RefreshContextValue {
  /** Register a refresh handler; returns an unregister function. */
  registerRefreshHandler: (handler: RefreshHandler) => () => void;
  triggerRefresh: () => Promise<RefreshOutcome>;
}

const RefreshContext = createContext<RefreshContextValue>({
  registerRefreshHandler: () => () => {},
  triggerRefresh: async () => 'ok',
});

interface RefreshProviderProps {
  children: React.ReactNode;
  globalRefreshHandlers?: Array<() => Promise<void> | void>;
}

/** Runs a handler, catching both async rejection and a synchronous throw. */
function runHandler(handler: RefreshHandler): Promise<void> {
  return Promise.resolve().then(() => handler());
}

export const RefreshProvider: React.FC<RefreshProviderProps> = ({
  children,
  globalRefreshHandlers = [],
}) => {
  // A Set (not a single slot) so multiple mounted pages can each register a
  // handler. The tickets page stays mounted (hidden) behind other routes, so a
  // single-slot design let it clobber the visible page's handler.
  const handlersRef = useRef<Set<RefreshHandler>>(new Set());

  const registerRefreshHandler = useCallback((handler: RefreshHandler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  const triggerRefresh = useCallback(async (): Promise<RefreshOutcome> => {
    // Global handlers (session/teams/clock) refresh in the background — they
    // must never hold up the visible page's spinner.
    for (const handler of globalRefreshHandlers) {
      runHandler(handler).catch((err: unknown) => {
        console.error('[RefreshContext] global handler failed:', err);
      });
    }

    const pageResults = Array.from(handlersRef.current, runHandler);

    try {
      const settled = await withTimeout(
        Promise.allSettled(pageResults),
        REFRESH_TIMEOUT_MS,
        'Refresh timed out',
      );
      return settled.some((r) => r.status === 'rejected') ? 'failed' : 'ok';
    } catch {
      return 'timeout';
    }
  }, [globalRefreshHandlers]);

  return (
    <RefreshContext.Provider value={{ registerRefreshHandler, triggerRefresh }}>
      {children}
    </RefreshContext.Provider>
  );
};

/**
 * Register a pull-to-refresh handler for the current page. Pass `enabled=false`
 * to skip registration — used by always-mounted pages (e.g. the tickets page,
 * kept alive behind other routes) so they only refresh while actually visible.
 */
export const useRefresh = (handler: RefreshHandler, enabled = true): void => {
  const { registerRefreshHandler } = useContext(RefreshContext);

  useEffect(() => {
    if (!enabled) return;
    return registerRefreshHandler(handler);
  }, [handler, enabled, registerRefreshHandler]);
};

export const useRefreshTrigger = (): (() => Promise<RefreshOutcome>) => {
  const { triggerRefresh } = useContext(RefreshContext);
  return triggerRefresh;
};
