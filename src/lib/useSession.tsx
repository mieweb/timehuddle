/**
 * Session context — wraps the app and provides timecore auth state.
 *
 * Usage:
 *   wrap root with <SessionProvider>
 *   read auth state anywhere with useSession()
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

import { authApi, type TimecoreUser } from './api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SessionState {
  user: TimecoreUser | null;
  loading: boolean;
  /** True when the user is authenticated but has not yet claimed a username. */
  needsUsernameClaim: boolean;
  /** Re-fetch session from timecore — call after sign-in / sign-up. */
  refetch: () => Promise<void>;
  /** Sign out from timecore and clear local session state. */
  signOut: () => Promise<void>;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const SessionContext = createContext<SessionState>({
  user: null,
  loading: true,
  needsUsernameClaim: false,
  refetch: async () => {},
  signOut: async () => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<TimecoreUser | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSession = useCallback(async () => {
    setLoading(true);
    try {
      const data = await authApi.getMe();
      setUser(data?.user ?? null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  const signOut = useCallback(async () => {
    await authApi.signOut().catch(() => {});
    setUser(null);
  }, []);

  const needsUsernameClaim = !!user && user.username === null;

  return (
    <SessionContext.Provider
      value={{ user, loading, needsUsernameClaim, refetch: fetchSession, signOut }}
    >
      {children}
    </SessionContext.Provider>
  );
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export const useSession = (): SessionState => useContext(SessionContext);
