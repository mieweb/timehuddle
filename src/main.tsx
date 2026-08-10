import './styles.css';

import { Capacitor } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';

// Confirms the OTA bundle booted — runs first, before any other bootstrap or
// network/chunk fetch. If the native layer doesn't hear this within
// appReadyTimeout it rolls back to the previous bundle.
if (Capacitor.isNativePlatform()) {
  CapacitorUpdater.notifyAppReady().catch((err) =>
    console.error('[TimeHuddle] notifyAppReady failed:', err),
  );
}

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
import { Browser } from '@capacitor/browser';
import React from 'react';
import { createRoot } from 'react-dom/client';

// Debug: check Capacitor bridge detection
_log(
  `Capacitor.isNativePlatform()=${Capacitor.isNativePlatform()}, platform=${Capacitor.getPlatform()}`,
);
_log(`window.webkit?.messageHandlers?.bridge=${!!(window as any).webkit?.messageHandlers?.bridge}`);
_log(`window.Capacitor=${JSON.stringify(Object.keys((window as any).Capacitor || {}))}`);

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

// ─── Deep link handling (Capacitor native only) ───────────────────────────────
//
// Password reset emails contain a timehuddle://reset?token=XXX link.
// When the user taps it, the OS opens the app and fires appUrlOpen.
// We store the token in this module-level variable so the App component
// can read it on mount (and on every resume).

let _deepLinkToken: string | null = null;

// Pending team/org join context from an OAuth deep link (?join=/?invite=/
// ?org_invite= carried through the native redirect-away-and-back flow, since
// the URL bar isn't available to read query params from on native). Applied
// once the App component sees an authenticated session.
let _pendingOAuthJoin: { join?: string; invite?: string; orgInvite?: string } | null = null;

if (Capacitor.isNativePlatform()) {
  void CapApp.addListener('appUrlOpen', ({ url }) => {
    try {
      const parsed = new URL(url);

      // OAuth callback: timehuddle://auth?meteor_token=...&meteor_resume=...
      if (parsed.host === 'auth') {
        const meteorResume = parsed.searchParams.get('meteor_resume');
        const join = parsed.searchParams.get('join');
        const invite = parsed.searchParams.get('invite');
        const orgInvite = parsed.searchParams.get('org_invite');
        if (join || invite || orgInvite) {
          _pendingOAuthJoin = {
            join: join ?? undefined,
            invite: invite ?? undefined,
            orgInvite: orgInvite ?? undefined,
          };
        }
        // Close the in-app browser and return to the app.
        void Browser.close();
        if (meteorResume) {
          localStorage.setItem('meteor_resume_token', meteorResume);
          // Notify SessionProvider to log the DDP connection in with the new
          // token and refetch — a bare renderRoot() won't re-authenticate.
          window.dispatchEvent(
            new CustomEvent('timehuddle:oauth-login', { detail: { resumeToken: meteorResume } }),
          );
        }
        return;
      }

      // Password reset: timehuddle://reset?token=XXX
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

// ─── OAuth callback handler (synchronous, before session check) ───────────────
// Handle OAuth callback tokens synchronously before session check runs.
// Stores meteor_resume token in localStorage so tryResumeLogin() picks it up.
(function handleOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const meteorResume = params.get('meteor_resume');
  if (meteorResume) {
    localStorage.setItem('meteor_resume_token', meteorResume);
    // Clean URL
    const url = new URL(window.location.href);
    url.searchParams.delete('meteor_token');
    url.searchParams.delete('meteor_resume');
    window.history.replaceState({}, '', url.toString());
  }
})();

// ─── App (client-side rendered, /app and all non-root routes) ─────────────────
_log('App component defined — modules loaded');

const App: React.FC = () => {
  const { user, loading, needsUsernameClaim, refetch } = useSession();
  const [ownershipChecked, setOwnershipChecked] = React.useState(false);
  const [showTakeOwnershipModal, setShowTakeOwnershipModal] = React.useState(false);

  // Auto-register push on native (APNs/FCM) and web (VAPID) after login.
  React.useEffect(() => {
    if (user) void autoRegisterPush(user.id);
  }, [user]);

  // Apply a pending team/org join from a social sign-in (?join=/?invite=/
  // ?org_invite=). Social sign-in redirects away to the IdP and back, so it
  // never runs LoginForm's password-flow `acceptInvitation()` — this is the
  // equivalent for OAuth, reading the params from the URL (web) or the
  // `timehuddle://auth` deep link (native).
  React.useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const join = params.get('join') ?? _pendingOAuthJoin?.join ?? null;
    const invite = params.get('invite') ?? _pendingOAuthJoin?.invite ?? null;
    const orgInvite = params.get('org_invite') ?? _pendingOAuthJoin?.orgInvite ?? null;
    if (!join && !invite && !orgInvite) return;
    _pendingOAuthJoin = null;

    void (async () => {
      const ddp = getDdpClient();
      try {
        if (invite) await ddp.acceptTeamInvitation(invite);
        if (orgInvite) await ddp.acceptOrgInvitation(orgInvite);
        if (join) await ddp.joinTeamByQrCode(join);
      } catch (err) {
        console.error('[oauth] pending team/org join failed:', err);
      }
      const url = new URL(window.location.href);
      url.searchParams.delete('join');
      url.searchParams.delete('invite');
      url.searchParams.delete('org_invite');
      window.history.replaceState(null, '', url.toString());
      await refetch();
    })();
  }, [user, refetch]);

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
          icon: '/logo.png',
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

  if (!user) {
    // Ensure we're on root path when showing login — fixes issue where
    // logout from /app/teams would show login form but keep /app/teams URL
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/app/')) {
      window.history.replaceState(null, '', '/');
    }
    return <LoginForm />;
  }

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

    _root = createRoot(el);
  }

  _root.render(
    <SessionProvider>
      <App />
    </SessionProvider>,
  );
}

renderRoot();
