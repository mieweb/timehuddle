/**
 * Session context — wraps the app and provides timecore auth state.
 *
 * Usage:
 *   wrap root with <SessionProvider>
 *   read auth state anywhere with useSession()
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

import { authApi, type TimecoreUser } from './api';
import { getDdpClient } from './ddp';

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
    console.log('[TimeHuddle] fetchSession: calling getMe...');
    const t = performance.now();
    try {
      const ddp = getDdpClient();
      const meteorUser = await ddp.getCurrentUser();
      
      if (meteorUser) {
        console.log(
          `[TimeHuddle] fetchSession: getMe resolved in ${(performance.now() - t).toFixed(0)}ms — user=${meteorUser.email}`
        );
        setUser({
          id: meteorUser.id,
          email: meteorUser.email,
          name: meteorUser.name,
          createdAt: new Date().toISOString(),
          emailVerified: meteorUser.emailVerified ?? true,
          image: meteorUser.image ?? null,
          backgroundUrl: null,
          username: meteorUser.username ?? null,
          organizationMembership: null,
          organizations: [],
        });
      } else {
        console.log(
          `[TimeHuddle] fetchSession: getMe resolved in ${(performance.now() - t).toFixed(0)}ms — no user found`
        );
        setUser(null);
      }
    } catch (err) {
      console.log(
        `[TimeHuddle] fetchSession: getMe failed in ${(performance.now() - t).toFixed(0)}ms — ${String(err)}`,
      );
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  const signOut = useCallback(async () => {
    // Clear token FIRST so no wormhole calls fire with invalidated token
    localStorage.removeItem('meteor_resume_token');
    // Clear user state immediately to stop any reactive refetches
    setUser(null);
    // Then invalidate server-side session
    const ddp = getDdpClient();
    await ddp.logout().catch(() => {});
    await authApi.signOut().catch(() => {});
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
