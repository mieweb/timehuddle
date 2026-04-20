import './styles.css';
import '../imports/startup/client';

import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { InboxPage } from '../imports/features/inbox/InboxPage';
import { AppLayout } from '../imports/ui/AppLayout';
import { LoginForm } from '../imports/ui/LoginForm';

/** Must match `imports/startup/ssr.tsx` query → initialMode mapping for /app hydration. */
function getSsrMatchedAuthMode(): 'login' | 'signup' | 'reset' {
  if (typeof window === 'undefined') return 'login';
  const m = new URLSearchParams(window.location.search).get('mode');
  if (m === 'signup') return 'signup';
  if (m === 'reset') return 'reset';
  return 'login';
}

// ─── App (client-side rendered, /app and all non-root routes) ─────────────────

const App: React.FC = () => {
  const user = useTracker(() => Meteor.user());
  const userId = useTracker(() => Meteor.userId());
  const loggingIn = useTracker(() => Meteor.loggingIn());

  const [authUiReady, setAuthUiReady] = useState(false);
  useEffect(() => {
    setAuthUiReady(true);
  }, []);

  if (!authUiReady) {
    return <LoginForm initialMode={getSsrMatchedAuthMode()} />;
  }

  if (loggingIn || (userId && !user)) {
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

Meteor.startup(() => {
  const el = document.getElementById('root');
  if (!el) return;

  if (window.location.pathname === '/') {
    // Root redirects to /app (login or dashboard depending on auth state).
    window.location.replace('/app');
    return;
  } else if (window.location.pathname === '/inbox') {
    // Dev inbox — no auth required, no SSR to hydrate.
    createRoot(el).render(<InboxPage />);
  } else if (window.location.pathname.startsWith('/app')) {
    // SSR sends a loading placeholder (not a full React tree), so use
    // createRoot — hydrateRoot would throw a hydration mismatch.
    createRoot(el).render(<App />);
  } else {
    // Unknown routes — no SSR content to hydrate, mount fresh.
    createRoot(el).render(<App />);
  }
});
