import './styles.css';
import '../imports/startup/client';

import { Meteor } from 'meteor/meteor';
import React from 'react';
import { createRoot } from 'react-dom/client';

import { InboxPage } from '../imports/features/inbox/InboxPage';
import { SessionProvider, useSession } from '../imports/lib/useSession';
import { AppLayout } from '../imports/ui/AppLayout';
import { LoginForm } from '../imports/ui/LoginForm';

// ─── App (client-side rendered, /app and all non-root routes) ─────────────────

const App: React.FC = () => {
  const { user, loading } = useSession();

  // If a reset token is present in the URL, show the reset-confirm form
  // regardless of auth state (so users can reset even if cookies are stale).
  const resetToken =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('token')
      : null;

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
    createRoot(el).render(
      <SessionProvider>
        <App />
      </SessionProvider>,
    );
  } else {
    createRoot(el).render(
      <SessionProvider>
        <App />
      </SessionProvider>,
    );
  }
});
