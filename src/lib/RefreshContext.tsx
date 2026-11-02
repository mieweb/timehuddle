/**
 * RefreshContext - Coordinates pull-to-refresh across pages.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef } from 'react';

type RefreshHandler = () => Promise<void> | void;

/** Longest a pull-to-refresh waits on its handlers before the indicator clears. */
export const REFRESH_TIMEOUT_MS = 15_000;

interface RefreshContextValue {
  /** Register a refresh handler; returns an unregister function. */
  registerRefreshHandler: (handler: RefreshHandler) => () => void;
  triggerRefresh: () => Promise<void>;
}

const RefreshContext = createContext<RefreshContextValue>({
  registerRefreshHandler: () => () => {},
  triggerRefresh: async () => {},
});

interface RefreshProviderProps {
  children: React.ReactNode;
  globalRefreshHandlers?: Array<() => Promise<void> | void>;
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

  const triggerRefresh = useCallback(async () => {
    const promises: Promise<unknown>[] = [];

    for (const handler of [...handlersRef.current, ...globalRefreshHandlers]) {
      try {
        const result = handler();
        if (result instanceof Promise) promises.push(result);
      } catch (err) {
        console.error('[Refresh] handler threw:', err);
      }
    }

    // A handler that rejects or never settles (a request on a dead socket) must
    // not keep the pull indicator up, so settle independently and stop waiting at the cap.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cap = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, REFRESH_TIMEOUT_MS);
    });
    try {
      await Promise.race([Promise.allSettled(promises), cap]);
    } finally {
      clearTimeout(timer);
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

export const useRefreshTrigger = (): (() => Promise<void>) => {
  const { triggerRefresh } = useContext(RefreshContext);
  return triggerRefresh;
};
