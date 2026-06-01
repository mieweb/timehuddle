/**
 * RefreshContext - Coordinates pull-to-refresh across pages.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef } from 'react';

type RefreshHandler = () => Promise<void> | void;

interface RefreshContextValue {
  registerRefreshHandler: (handler: RefreshHandler) => void;
  triggerRefresh: () => Promise<void>;
}

const RefreshContext = createContext<RefreshContextValue>({
  registerRefreshHandler: () => {},
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
  const handlerRef = useRef<RefreshHandler | null>(null);

  const registerRefreshHandler = useCallback((handler: RefreshHandler) => {
    handlerRef.current = handler;
  }, []);

  const triggerRefresh = useCallback(async () => {
    const promises: Promise<void>[] = [];

    if (handlerRef.current) {
      const result = handlerRef.current();
      if (result instanceof Promise) {
        promises.push(result);
      }
    }

    for (const handler of globalRefreshHandlers) {
      const result = handler();
      if (result instanceof Promise) {
        promises.push(result);
      }
    }

    await Promise.all(promises);
  }, [globalRefreshHandlers]);

  return (
    <RefreshContext.Provider value={{ registerRefreshHandler, triggerRefresh }}>
      {children}
    </RefreshContext.Provider>
  );
};

export const useRefresh = (handler: RefreshHandler): void => {
  const { registerRefreshHandler } = useContext(RefreshContext);

  useEffect(() => {
    registerRefreshHandler(handler);
    return () => {
      registerRefreshHandler(() => {});
    };
  }, [handler, registerRefreshHandler]);
};

export const useRefreshTrigger = (): (() => Promise<void>) => {
  const { triggerRefresh } = useContext(RefreshContext);
  return triggerRefresh;
};
