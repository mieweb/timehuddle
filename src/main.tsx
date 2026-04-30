import './styles.css';

import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import React from 'react';
import { createRoot } from 'react-dom/client';

import { InboxPage } from './features/inbox/InboxPage';
import { SessionProvider, useSession } from './lib/useSession';
import { AppLayout } from './ui/AppLayout';
import { LandingPage } from './ui/LandingPage';
import { LoginForm } from './ui/LoginForm';

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

const App: React.FC = () => {
  const { user, loading } = useSession();

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
  return <AppLayout />;
};

// ─── Entry point ──────────────────────────────────────────────────────────────

let _root: ReturnType<typeof createRoot> | null = null;

function renderRoot() {
  const el = document.getElementById('root');
  if (!el) return;

  if (!_root) {
    if (window.location.pathname === '/') {
      // On native (Capacitor iOS/Android) the WebView always starts at '/'.
      // Skip the marketing landing page and go straight to the app.
      if (Capacitor.isNativePlatform()) {
        _root = createRoot(el);
        _root.render(
          <SessionProvider>
            <App />
          </SessionProvider>,
        );
        return;
      }
      _root = createRoot(el)
      _root.render(<LandingPage />);
      return;
    } else if (window.location.pathname === '/inbox') {
      _root = createRoot(el);
      _root.render(<InboxPage />);
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
