import './styles.css';

// ─── Eager theme + brand bootstrap ───────────────────────────────────────────
// Apply theme immediately (before React mounts) so login, landing, and all
// pre-auth pages receive the correct data-theme / .dark class without flicker.
(function applyBootstrapTheme() {
  const stored = localStorage.getItem('app:theme');
  const theme = stored === 'light' || stored === 'dark' ? stored : 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.classList.toggle('dark', theme === 'dark');
})();

// Apply brand CSS eagerly so login/signup pages get the right brand colors.
// useBrand() only runs inside AppLayout, so pre-auth pages need this bootstrap.
(function applyBootstrapBrand() {
  const BUILD_TIME_BRAND = 'bluehive';
  const DEFAULT_BRAND = 'webchart';
  const stored = localStorage.getItem('app:brand');
  const brand = stored || DEFAULT_BRAND;
  if (brand === BUILD_TIME_BRAND) return; // baked into CSS, no injection needed
  // Dynamically import brand and inject CSS — async but fast enough for pre-auth pages
  import('@mieweb/ui/brands').then(({ generateBrandCSS, brands }) => {
    const loader = brands[brand as keyof typeof brands] ?? brands[DEFAULT_BRAND];
    loader().then((config) => {
      const el = document.createElement('style');
      el.id = 'mieweb-brand-override';
      el.textContent = generateBrandCSS(config);
      document.head.appendChild(el);
    });
  });
})();

// ─── Startup timing (visible in Xcode device console) ─────────────────────────
const t0 = performance.now();
const _log = (msg: string) =>
  console.log(`[TimeHuddle] +${(performance.now() - t0).toFixed(0)}ms ${msg}`);
_log('main.tsx evaluated');

import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import React from 'react';
import { createRoot } from 'react-dom/client';

import { InboxPage } from './features/inbox/InboxPage';
import { enterpriseApi } from './lib/api';
import { getDdpClient, subscribeNewNotifications } from './lib/ddp';
import { MESSAGES_PENDING_THREAD_KEY } from './lib/constants';
import { autoRegisterPush, checkPushNotificationStatus } from './lib/nativePush';
import { SessionProvider, useSession } from './lib/useSession';
import { AppLayout } from './ui/AppLayout';
import { InstallerModal } from './ui/InstallerModal';
import { LandingPage } from './ui/LandingPage';
import { LoginForm } from './ui/LoginForm';
import { UsernameClaimModal } from './ui/UsernameClaimModal';

// ─── Username path detection ──────────────────────────────────────────────────

/** Regex matching /:username — 3-30 chars, start/end alphanumeric. */
const USERNAME_PATH_RE = /^\/([a-z0-9][a-z0-9_-]{1,28}[a-z0-9])$/;

/** Reserved path segments that must never be treated as usernames. */
const RESERVED_PATHS = new Set([
  'app',
  'api',
  'auth',
  'login',
  'logout',
  'signup',
  'register',
  'admin',
  'dashboard',
  'settings',
  'profile',
  'account',
  'user',
  'static',
  'assets',
  'public',
  'health',
  'favicon',
  'robots',
  'sw',
  'manifest',
  'sitemap',
  'feed',
  'rss',
  'help',
  'support',
  'about',
  'contact',
  'privacy',
  'terms',
  'legal',
]);

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
  const [ownershipChecked, setOwnershipChecked] = React.useState(false);
  const [showTakeOwnershipModal, setShowTakeOwnershipModal] = React.useState(false);

  // Handle GitHub OAuth callback via Meteor
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const meteorToken = params.get('meteor_token');
    const meteorResume = params.get('meteor_resume');

    if (meteorToken && meteorResume) {
      // Clear params from URL
      window.history.replaceState({}, '', window.location.pathname);

      // Login to Meteor DDP with the resume token
      const ddp = getDdpClient();
      ddp
        .loginWithMeteorToken(meteorToken, meteorResume)
        .then((success) => {
          if (success) {
            console.log('[App] GitHub OAuth login success');
            // Trigger session refetch
            window.location.reload();
          }
        })
        .catch((err) => {
          console.error('[App] GitHub OAuth login failed:', err);
        });
    }
  }, []);

  // Auto-register push on native (APNs/FCM) and web (VAPID) after login.
  React.useEffect(() => {
    if (user) void autoRegisterPush(user.id);
  }, [user]);

  // SSE fallback: show a browser Notification for every incoming SSE event.
  // This fires even when FCM/VAPID push delivery is unreliable (e.g. localhost).
  // Skipped on native Capacitor (APNs handles it), when permission not granted,
  // or when the user has not opted in to push notifications (unsubscribed).
  React.useEffect(() => {
    if (!user || Capacitor.isNativePlatform()) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    void checkPushNotificationStatus().then((status) => {
      if (cancelled || !status.subscribed) return;
      unsubscribe = subscribeNewNotifications((n) => {
        const nData = n.data;
        const notif = new Notification(n.title, {
          body: n.body,
          icon: '/timehuddle-icon.svg',
          tag: (nData?.type as string | undefined) ?? 'timehuddle',
          silent: false,
        });
        if (nData) {
          notif.onclick = () => {
            window.focus();
            if (nData.type === 'message' && nData.teamId && nData.adminId && nData.memberId) {
              try {
                sessionStorage.setItem(
                  MESSAGES_PENDING_THREAD_KEY,
                  JSON.stringify({
                    teamId: String(nData.teamId),
                    adminId: String(nData.adminId),
                    memberId: String(nData.memberId),
                  }),
                );
              } catch {
                /* ignore */
              }
              window.dispatchEvent(
                new CustomEvent('timehuddle:openThread', {
                  detail: {
                    teamId: String(nData.teamId),
                    adminId: String(nData.adminId),
                    memberId: String(nData.memberId),
                  },
                }),
              );
            }
            const url = nData.url as string | undefined;
            if (url) {
              const path = url.split('?')[0];
              if (path.startsWith('/app/')) {
                window.history.pushState(null, '', path);
                window.dispatchEvent(new PopStateEvent('popstate'));
              }
            }
          };
        }
      });
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [user]);

  React.useEffect(() => {
    if (!user || needsUsernameClaim) {
      setOwnershipChecked(false);
      setShowTakeOwnershipModal(false);
      return;
    }

    let cancelled = false;
    void enterpriseApi
      .getOwnershipStatus()
      .then((status) => {
        if (cancelled) return;
        setShowTakeOwnershipModal(!status.installCompleted && !status.hasOwner);
      })
      .catch(() => {
        if (cancelled) return;
        setShowTakeOwnershipModal(false);
      })
      .finally(() => {
        if (cancelled) return;
        setOwnershipChecked(true);
      });

    return () => {
      cancelled = true;
    };
  }, [user, needsUsernameClaim]);

  // Reset token: check URL params (web) or deep link (native).
  const resetToken =
    _deepLinkToken ??
    (typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('token')
      : null);

  if (resetToken) {
    return <LoginForm initialMode="reset-confirm" />;
  }

  // Wait for initial session check to complete before showing login
  // (but allow app to render during refetch when user is already known)
  if (loading && !user) {
    return null;
  }

  if (!user) return <LoginForm />;

  // If the user is already authenticated and there are OAuth 2.0 authorization
  // params in the URL (e.g. redirected here from TimeHarbor), forward them
  // back to Better Auth's authorization endpoint so it can issue the code.
  const oauthParams =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  if (
    oauthParams?.get('response_type') &&
    oauthParams?.get('client_id') &&
    oauthParams?.get('state')
  ) {
    // The app uses Bearer token (localStorage) for API calls, but the OIDC /authorize
    // endpoint is a browser navigation — it can't send custom headers. Copy the token
    // into a cookie so Better Auth can recognise the session during the authorize flow.
    const token = localStorage.getItem('timecore_session_token');
    if (token) {
      document.cookie = `better-auth.session_token=${token}; path=/; SameSite=Lax`;
    }
    window.location.href = `/api/auth/oauth2/authorize?${oauthParams.toString()}`;
    return null;
  }
  if (needsUsernameClaim)
    return (
      <>
        <AppLayout />
        <UsernameClaimModal />
      </>
    );

  return (
    <>
      <AppLayout />
      {ownershipChecked && showTakeOwnershipModal && (
        <InstallerModal onTaken={() => setShowTakeOwnershipModal(false)} />
      )}
    </>
  );
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

    // Public profile route — /:username
    // AppLayout handles this internally, so fall through to <App /> which keeps the sidebar.
    // The USERNAME_PATH_RE + RESERVED_PATHS check is still used by AppLayout for in-app routing.
    const usernameMatch = window.location.pathname.match(USERNAME_PATH_RE);
    if (usernameMatch && !RESERVED_PATHS.has(usernameMatch[1])) {
      _log(`profile route — @${usernameMatch[1]} — mounting full app shell`);
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
