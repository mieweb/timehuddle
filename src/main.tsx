import './styles.css';

// ─── Startup timing (visible in Xcode device console) ─────────────────────────
const t0 = performance.now();
const _log = (msg: string) =>
  console.log(`[TimeHuddle] +${(performance.now() - t0).toFixed(0)}ms ${msg}`);
_log('main.tsx evaluated');

import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import React from 'react';
import { createRoot } from 'react-dom/client';

import { PublicProfilePage } from './features/profile/PublicProfilePage';
import { InboxPage } from './features/inbox/InboxPage';
import { SessionProvider, useSession } from './lib/useSession';
import { AppLayout } from './ui/AppLayout';
import { LandingPage } from './ui/LandingPage';
import { LoginForm } from './ui/LoginForm';
import { UsernameClaimModal } from './ui/UsernameClaimModal';

// ─── Username path detection ──────────────────────────────────────────────────

/** Regex matching /:username — 3-30 chars, start/end alphanumeric. */
const USERNAME_PATH_RE = /^\/([a-z0-9][a-z0-9_-]{1,28}[a-z0-9])$/;

// ─── Deep link handling (Capacitor native only) ───────────────────────────────
//
// Password reset emails contain a timehuddle://reset?token=XXX link.
// When the user taps it, the OS opens the app and fires appUrlOpen.
// We store the token in this module-level variable so the App component
// can read it on mount (and on every resume).

let _deepLinkToken: string | null = null;

if (Capacitor.isNativePlatform()) {
  void CapApp.addListener('appUrlOpen', ({ url }) => {
    try {
      // Expected format: timehuddle://reset?token=<value>
      const parsed = new URL(url);
      const token = parsed.searchParams.get('token');
      if (token) {
        _deepLinkToken = token;
        // Re-render the root so the App component picks up the token.
        renderRoot();
      }
    } catch {
      // Malformed URL — ignore
    }
  });
}

// ─── App (client-side rendered, /app and all non-root routes) ─────────────────
_log('App component defined — modules loaded');

const App: React.FC = () => {
  const { user, loading, needsUsernameClaim } = useSession();

  // Reset token: check URL params (web) or deep link (native).
  const resetToken =
    _deepLinkToken ??
    (typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('token')
      : null);

  if (resetToken) {
    return <LoginForm initialMode="reset-confirm" />;
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-100 dark:bg-neutral-900">
        <p className="text-sm text-neutral-600 dark:text-neutral-300">Loading…</p>
      </div>
    );
  }

  if (!user) return <LoginForm />;
  if (needsUsernameClaim)
    return (
      <>
        <AppLayout />
        <UsernameClaimModal />
      </>
    );
  return <AppLayout />;
};

// ─── Entry point ──────────────────────────────────────────────────────────────

let _root: ReturnType<typeof createRoot> | null = null;

function renderRoot() {
  _log('renderRoot called');
  const el = document.getElementById('root');
  if (!el) return;

  if (!_root) {
    if (window.location.pathname === '/') {
      // On native (Capacitor iOS/Android) the WebView always starts at '/'.
      // Skip the marketing landing page and go straight to the app.
      if (Capacitor.isNativePlatform()) {
        _log('native platform detected — mounting SessionProvider + App');
        _root = createRoot(el);
        _root.render(
          <SessionProvider>
            <App />
          </SessionProvider>,
        );
        return;
      }
      _root = createRoot(el);
      _root.render(<LandingPage />);
      return;
    } else if (window.location.pathname === '/inbox') {
      _root = createRoot(el);
      _root.render(<InboxPage />);
      return;
    }

    // Public profile route — /:username (no auth required)
    const usernameMatch = window.location.pathname.match(USERNAME_PATH_RE);
    if (usernameMatch) {
      const username = usernameMatch[1];
      _log(`public profile route — @${username}`);
      _root = createRoot(el);
      _root.render(
        <SessionProvider>
          <PublicProfilePage username={username} />
        </SessionProvider>,
      );
      return;
    }

    _root = createRoot(el);
  }

  _root.render(
    <SessionProvider>
      <App />
    </SessionProvider>,
  );
}

renderRoot();
