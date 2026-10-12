/**
 * AppLayout — Root shell for all authenticated app routes.
 *
 * Composes three primitives:
 *   • Sidebar     — collapsible, icon-only or full width, drawer on mobile
 *   • AppHeader   — sticky top bar with the org/team switcher and user menu
 *   • <main>      — scrollable content area, led by <PageTitle />
 *
 * RouterProvider (./router) is the single source of truth for the URL so any
 * descendant — TeamContext included — can read the current route or navigate
 * without prop-drilling or an external router library.
 *
 * SidebarContext owns expand/collapse + mobile drawer state.
 */
import React, {
  Activity,
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Spinner, ToastProvider } from '@mieweb/ui';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

import { WhatsNewBanner } from '../features/release-notes/WhatsNewBanner';
import { TicketStartProvider } from '../features/timers/TicketStartProvider';
import { SIDEBAR_KEY } from '../lib/constants';
import { TeamProvider, useTeam } from '../lib/TeamContext';
import { AppToasts } from './AppToasts';
import { useBrand } from '../lib/useBrand';
import { useClockDocumentTitle } from '../lib/useClockDocumentTitle';
import { useSession } from '../lib/useSession';
import { RefreshProvider } from '../lib/RefreshContext';
import { ShiftReminderProvider } from '../features/notifications/ShiftReminderContext';
import { FeedbackModal } from '../features/feedback/FeedbackModal';
import { ReportIssueModal } from '../features/feedback/ReportIssueModal';
import { AppHeader } from './AppHeader';
import { BottomNav } from './BottomNav';
import { CommandPalette } from './CommandPalette';
import { PageTitleContext } from './pageTitle';
import { PullToRefresh } from './PullToRefresh';
import { NoAccessState } from './NoAccessState';
import { matchPath, RouterProvider, useRouter } from './router';
import { SettingsPage } from './SettingsPage';
import { Sidebar } from './Sidebar';

// ─── Router ───────────────────────────────────────────────────────────────────
export type { RouterCtx } from './router';
export { RouterContext, useRouter } from './router';

// ─── Pages (code-split) ───────────────────────────────────────────────────────
// Each page is its own chunk so the shell paints without downloading every
// page's dependencies (the Kerebron editor alone is several hundred KB).

/** React.lazy for a named export. */
function lazyNamed<K extends string, M extends Record<K, React.ComponentType<any>>>(
  load: () => Promise<M>,
  name: K,
) {
  return lazy(() => load().then((m) => ({ default: m[name] })));
}

const ClockPage = lazyNamed(() => import('../features/clock/ClockPage'), 'ClockPage');
const DashboardPage = lazyNamed(
  () => import('../features/dashboard/DashboardPage'),
  'DashboardPage',
);
const NotificationsPage = lazyNamed(
  () => import('../features/notifications/NotificationsPage'),
  'NotificationsPage',
);
const ProfilePage = lazyNamed(() => import('../features/profile/ProfilePage'), 'ProfilePage');
const ReleaseNotesPage = lazyNamed(
  () => import('../features/release-notes/ReleaseNotesPage'),
  'ReleaseNotesPage',
);
const SeederPage = lazyNamed(() => import('../features/seeder/SeederPage'), 'SeederPage');
const TeamsPage = lazyNamed(() => import('../features/teams/TeamsPage'), 'TeamsPage');
const TicketsPage = lazyNamed(() => import('../features/tickets/TicketsPage'), 'TicketsPage');
const RedmineIssueDetailPage = lazyNamed(
  () => import('../features/tickets/detail/RedmineIssueDetailPage'),
  'RedmineIssueDetailPage',
);
const TicketDetailPage = lazyNamed(
  () => import('../features/tickets/detail/TicketDetailPage'),
  'TicketDetailPage',
);
const WorkPage = lazyNamed(() => import('../features/timers/WorkPage'), 'WorkPage');
const ActivityLogPage = lazyNamed(
  () => import('../features/activity/ActivityLogPage'),
  'ActivityLogPage',
);
const OrganizationMembersPage = lazyNamed(
  () => import('../features/org/OrganizationMembersPage'),
  'OrganizationMembersPage',
);
const OrgUsagePage = lazyNamed(() => import('../features/usage/OrgUsagePage'), 'OrgUsagePage');
const Huddle = lazy(() => import('../pages/Huddle'));
const HiPage = lazyNamed(() => import('../pages/HiPage'), 'HiPage');
const OrganizationOverviewPage = lazyNamed(
  () => import('../features/org/OrganizationOverviewPage'),
  'OrganizationOverviewPage',
);
const OrganizationPage = lazyNamed(
  () => import('../features/org/OrganizationPage'),
  'OrganizationPage',
);
const EnterprisePage = lazyNamed(
  () => import('../features/enterprise/EnterprisePage'),
  'EnterprisePage',
);

/** Shown in place of a page while its chunk downloads. */
const PageLoading: React.FC = () => (
  <div className="page-loading flex justify-center py-12" aria-live="polite" aria-busy="true">
    <Spinner />
    <span className="sr-only">Loading page</span>
  </div>
);

// ─── Route registry ───────────────────────────────────────────────────────────

interface RouteConfig {
  title: string;
  component: React.ComponentType;
}

const ROUTES: Record<string, RouteConfig> = {
  '/app/admin/organization': { title: 'Organization Admin', component: OrganizationOverviewPage },

  '/app/activity': { title: 'Activity Log', component: ActivityLogPage },
  '/app/clock': { title: 'Clock In/Out', component: ClockPage },
  '/app/dashboard': { title: 'Dashboard', component: DashboardPage },
  '/app/hi': { title: 'Hi', component: HiPage },
  '/app/huddle': { title: 'Huddle', component: Huddle },
  '/app/notifications': { title: 'Notifications', component: NotificationsPage },
  '/app/enterprise': { title: 'Enterprise', component: EnterprisePage },
  '/app/organization': { title: 'Organization', component: OrganizationPage },
  '/app/release-notes': { title: 'What’s New', component: ReleaseNotesPage },
  '/app/settings': { title: 'Settings', component: SettingsPage },
  ...(import.meta.env.MODE !== 'production'
    ? { '/app/seeder': { title: 'Seeder', component: SeederPage } }
    : {}),
  '/app/teams': { title: 'Teams', component: TeamsPage },
  '/app/tickets': { title: 'Tickets', component: TicketsPage },
  '/app/work': { title: 'Work', component: WorkPage },

  '/app/org/members': { title: 'Members', component: OrganizationMembersPage },
  '/app/org/usage': { title: 'Usage', component: OrgUsagePage },
};

/** Null when nothing matches — the caller shows not-found rather than a page
 *  the URL didn't ask for. */
function match(pathname: string): RouteConfig | null {
  if (matchPath('/app/teams/:teamId', pathname)) return ROUTES['/app/teams'];
  return ROUTES[pathname] ?? null;
}

// ─── Context ─────────────────────────────────────────────────────────────────

export interface SidebarCtx {
  isExpanded: boolean;
  isMobileOpen: boolean;
  toggle: () => void;
  openMobile: () => void;
  closeMobile: () => void;
}

export const SidebarContext = createContext<SidebarCtx>({
  isExpanded: true,
  isMobileOpen: false,
  toggle: () => {},
  openMobile: () => {},
  closeMobile: () => {},
});

export const useSidebar = () => useContext(SidebarContext);

export const AppFeedbackContext = createContext<{
  openReportIssue: () => void;
  openFeedback: () => void;
}>({ openReportIssue: () => {}, openFeedback: () => {} });

export const useAppFeedback = () => useContext(AppFeedbackContext);

// ─── Foreground notification banner type ─────────────────────────────────────

interface ForegroundNotif {
  title: string;
  body: string;
  data: Record<string, string>;
}

// ─── AppLayout Content ────────────────────────────────────────────────────────

const AppLayoutContent: React.FC = () => {
  const { refetch: refetchSession } = useSession();
  const { refetchTeams, refetchClock, teamAccess, orgAccess } = useTeam();

  useBrand();

  const { pathname, navigate } = useRouter();

  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  // ── Shared notification data handler ──────────────────────────────────────
  const handleNotificationData = useCallback(
    (data: Record<string, string>) => {
      console.log('[handleNotificationData] received:', JSON.stringify(data));
      if (data.type === 'shift-end-reminder') {
        window.dispatchEvent(
          new CustomEvent('timehuddle:openShiftReminder', {
            detail: { clockEventId: data.clockEventId, teamId: data.teamId },
          }),
        );
      } else if (data.type === 'huddle-comment' || data.type === 'huddle-mention') {
        // data.url carries ?postId=... so Huddle opens the conversation holding it.
        navigate(data.url || '/app/huddle');
      } else if (data.type === 'team-join-request') {
        // Navigate to notifications page where user can approve/decline
        navigate('/app/notifications');
      } else if (data.type === 'team-join-request-approved') {
        // Navigate to the team page
        if (data.url) navigate(data.url);
      } else if (data.type === 'team-join-request-declined') {
        // Navigate to teams page
        if (data.url) navigate(data.url);
      } else if (data.url) {
        const safePath = data.url.split('?')[0];
        console.log('[handleNotificationData] safePath:', safePath);
        if (safePath.startsWith('/app/')) {
          console.log('[handleNotificationData] calling navigate:', data.url);
          navigate(data.url);
        }
      }
    },
    [navigate],
  );

  // ── Foreground in-app notification banner state ───────────────────────────
  const [foregroundNotif, setForegroundNotif] = useState<ForegroundNotif | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Native push listeners (single combined effect) ────────────────────────
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const handles: { remove: () => void }[] = [];

    // Background/cold-start tap → Capacitor queues the launch notification and
    // replays it here once this listener attaches.
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      console.log('[ActionPerformed] data:', JSON.stringify(action.notification.data));
      handleNotificationData((action.notification.data ?? {}) as Record<string, string>);
    })
      .then((h) => handles.push(h))
      .catch(() => {});

    // Foreground push → iOS shows the native banner (presentationOptions in
    // capacitor.config.ts). Taps come back through the listener above.
    PushNotifications.addListener('pushNotificationReceived', (_notification) => {
      // intentionally empty — iOS handles the banner natively
    })
      .then((h) => handles.push(h))
      .catch(() => {});

    return () => {
      handles.forEach((h) => h.remove());
    };
  }, [handleNotificationData]);

  // ── Native deep links (timehuddle://open/<path>) ───────────────────────────
  // Covers links tapped outside a push notification (e.g. shared from another
  // app). main.tsx's `appUrlOpen` runs before this component mounts on a cold
  // start, so the path is stashed in localStorage there and drained here.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    try {
      const pendingPath = window.localStorage.getItem('pendingDeepLinkPath');
      if (pendingPath) {
        window.localStorage.removeItem('pendingDeepLinkPath');
        navigate(pendingPath);
      }
    } catch {
      /* ignore */
    }

    const handler = (e: Event) => {
      const path = (e as CustomEvent<{ path?: string }>).detail?.path;
      if (!path) return;
      // main.tsx always stashes the path for the cold-start case; a live
      // listener acknowledges it here so it isn't replayed on the next mount.
      try {
        window.localStorage.removeItem('pendingDeepLinkPath');
      } catch {
        /* ignore */
      }
      navigate(path);
    };
    window.addEventListener('timehuddle:deeplink', handler);
    return () => window.removeEventListener('timehuddle:deeplink', handler);
  }, [navigate]);

  // ── Web push: service worker message handler ──────────────────────────────
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'timehuddle:openShiftReminder') {
        window.dispatchEvent(
          new CustomEvent('timehuddle:openShiftReminder', { detail: event.data }),
        );
      }
      // Foreground web push tap — sw.js posts this instead of doing a hard navigate
      if (event.data?.type === 'timehuddle:navigate' && event.data?.url) {
        navigate(event.data.url);
      }
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, [navigate]);

  // ── Parameterized routes ──────────────────────────────────────────────────
  // /app/profile/:id  — Mongo ObjectId (24-char hex), numeric ID, or Meteor's
  //   default Accounts user _id (17-char Random.id() string — no idGeneration
  //   override is configured for Meteor.users, unlike the ObjectId-based
  //   collections, so plain userIds like those on huddle posts/tickets don't
  //   match the hex regex and would otherwise be misread as a username below).
  // /app/profile/:username — anything else (falls through from the ID check)
  const profileSegment = matchPath('/app/profile/:idOrUsername', pathname)?.idOrUsername ?? null;
  const profileUserId =
    profileSegment && /^[a-f0-9]{24}$|^\d+$|^[A-Za-z0-9]{17}$/.test(profileSegment)
      ? profileSegment
      : null;
  const profileUsername = profileSegment && !profileUserId ? profileSegment : null;

  // A Redmine issue lives under its own prefix; Huddle ticket ids are 24-char
  // hex, so the two can never collide.
  const redmineIssueMatch = !profileSegment
    ? /^\/app\/tickets\/redmine\/(\d+)$/.exec(pathname)
    : null;
  const redmineIssueId = redmineIssueMatch ? Number(redmineIssueMatch[1]) : null;

  // Exact, so `/app/tickets/abc/extra` is an unknown path rather than a ticket
  // id with the extra segments swallowed into it.
  const ticketDetailId =
    !profileSegment && !redmineIssueMatch
      ? (matchPath('/app/tickets/:ticketId', pathname)?.ticketId ?? null)
      : null;

  const isDynamicRoute = Boolean(
    profileUserId || profileUsername || ticketDetailId || redmineIssueId,
  );
  const route = isDynamicRoute ? null : match(pathname);
  const pathNotFound = !isDynamicRoute && !route;

  // Shown in the browser tab. Covers the dynamic routes too, which have no
  // registry entry.
  const documentTitle =
    profileUserId || profileUsername
      ? 'Profile'
      : ticketDetailId
        ? 'Ticket'
        : redmineIssueId
          ? 'Issue'
          : pathNotFound
            ? 'Page not found'
            : (route?.title ?? 'App');
  useClockDocumentTitle(documentTitle);

  // A linked team the user isn't in replaces the page — never shows another team.
  const teamForbidden = teamAccess === 'forbidden';
  const orgForbidden = orgAccess === 'forbidden';
  const scopeForbidden = teamForbidden || orgForbidden;

  // Rendered in the body by <PageTitle />. Null on profile and ticket detail
  // (both already lead with a more specific heading of their own), and on the
  // no-access state, which has its own.
  const pageTitle = scopeForbidden ? null : (route?.title ?? null);

  const isTicketsRoute =
    !scopeForbidden &&
    !profileUserId &&
    !profileUsername &&
    !ticketDetailId &&
    !redmineIssueId &&
    pathname === '/app/tickets';

  // Huddle is mounted on its first visit and kept after that: <Activity> hides
  // it (state, scroll and composer drafts survive; its effects and
  // subscriptions pause) instead of tearing it down and refetching on return.
  const isHuddleRoute =
    !scopeForbidden &&
    !profileUserId &&
    !profileUsername &&
    !ticketDetailId &&
    !redmineIssueId &&
    pathname === '/app/huddle';
  const [huddleVisited, setHuddleVisited] = useState(isHuddleRoute);
  if (isHuddleRoute && !huddleVisited) setHuddleVisited(true);

  const [reportIssueOpen, setReportIssueOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // ── Sidebar ──
  const [isExpanded, setIsExpanded] = useState(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem(SIDEBAR_KEY) !== 'collapsed';
  });
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  const toggle = useCallback(() => {
    setIsExpanded((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_KEY, next ? 'expanded' : 'collapsed');
      return next;
    });
  }, []);

  const openMobile = useCallback(() => setIsMobileOpen(true), []);
  const closeMobile = useCallback(() => setIsMobileOpen(false), []);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 768) setIsMobileOpen(false);
    };
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <PageTitleContext.Provider value={pageTitle}>
      <RefreshProvider globalRefreshHandlers={[refetchSession, refetchTeams, refetchClock]}>
        <CommandPalette />
        <ReportIssueModal open={reportIssueOpen} onClose={() => setReportIssueOpen(false)} />
        <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
        <TicketStartProvider>
          <ShiftReminderProvider>
            <AppFeedbackContext.Provider
              value={{
                openReportIssue: () => setReportIssueOpen(true),
                openFeedback: () => setFeedbackOpen(true),
              }}
            >
              <SidebarContext.Provider
                value={{ isExpanded, isMobileOpen, toggle, openMobile, closeMobile }}
              >
                <div className="flex h-dvh overflow-hidden bg-neutral-50 font-sans text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
                  {/* Mobile backdrop */}
                  {isMobileOpen &&
                    createPortal(
                      <div
                        className="fixed inset-0 z-45 bg-black/50 backdrop-blur-sm md:hidden"
                        onClick={closeMobile}
                        aria-hidden
                      />,
                      document.body,
                    )}

                  {/* Foreground push notification banner (native iOS/Android) */}
                  {foregroundNotif &&
                    createPortal(
                      <div
                        onClick={() => {
                          handleNotificationData(foregroundNotif.data);
                          console.log(
                            '[Banner] tapped, data:',
                            JSON.stringify(foregroundNotif.data),
                          );
                          setForegroundNotif(null);
                          if (dismissTimer.current) clearTimeout(dismissTimer.current);
                        }}
                        className="fixed top-4 left-1/2 -translate-x-1/2 z-9999 w-[90%] max-w-sm md:w-auto md:max-w-md
                                   bg-neutral-900 dark:bg-neutral-800 text-white rounded-2xl
                                   shadow-xl px-4 py-3 cursor-pointer flex flex-col gap-0.5
                                   border border-white/10"
                        role="alert"
                      >
                        <span className="font-semibold text-sm leading-tight">
                          {foregroundNotif.title}
                        </span>
                        <span className="text-xs text-neutral-300 leading-snug">
                          {foregroundNotif.body}
                        </span>
                      </div>,
                      document.body,
                    )}

                  <Sidebar />

                  {/* Content column */}
                  <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                    <AppHeader />
                    <WhatsNewBanner placement="mobile" />
                    <main ref={mainRef} className="flex-1 overflow-auto app-main-scroll md:pb-0">
                      <PullToRefresh>
                        {/* TicketsPage stays mounted to preserve its state, and
                            is only hidden when another route is showing. The
                            tickets page renders its own heading, so the registry
                            title is always withheld from this instance to avoid
                            a duplicate h1. */}
                        <PageTitleContext.Provider value={null}>
                          <div
                            className={
                              isTicketsRoute
                                ? 'h-full w-full flex flex-col'
                                : 'absolute w-0 h-0 overflow-hidden invisible pointer-events-none'
                            }
                          >
                            {/* Own boundary: this always-mounted page loads in
                                the background without blanking the visible one. */}
                            <Suspense fallback={isTicketsRoute ? <PageLoading /> : null}>
                              <TicketsPage />
                            </Suspense>
                          </div>
                        </PageTitleContext.Provider>
                        {huddleVisited && (
                          <PageTitleContext.Provider value={isHuddleRoute ? pageTitle : null}>
                            <Activity mode={isHuddleRoute ? 'visible' : 'hidden'}>
                              <Suspense fallback={<PageLoading />}>
                                <Huddle />
                              </Suspense>
                            </Activity>
                          </PageTitleContext.Provider>
                        )}
                        <Suspense fallback={<PageLoading />}>
                          {scopeForbidden ? (
                            <NoAccessState
                              kind="forbidden"
                              resource={teamForbidden ? 'team' : 'org'}
                            />
                          ) : profileUserId ? (
                            <ProfilePage key={profileUserId} userId={profileUserId} />
                          ) : profileUsername ? (
                            <ProfilePage key={profileUsername} username={profileUsername} />
                          ) : ticketDetailId ? (
                            <TicketDetailPage ticketId={ticketDetailId} />
                          ) : redmineIssueId ? (
                            <RedmineIssueDetailPage issueId={redmineIssueId} />
                          ) : pathNotFound ? (
                            <NoAccessState kind="not-found" resource="page" />
                          ) : (
                            route &&
                            route.component !== TicketsPage &&
                            route.component !== Huddle &&
                            React.createElement(route.component)
                          )}
                        </Suspense>
                      </PullToRefresh>
                    </main>
                  </div>

                  <BottomNav />
                </div>
              </SidebarContext.Provider>
            </AppFeedbackContext.Provider>
          </ShiftReminderProvider>
        </TicketStartProvider>
      </RefreshProvider>
    </PageTitleContext.Provider>
  );
};

// ─── AppLayout (Team wrapper) ─────────────────────────────────────────────────

export const AppLayout: React.FC = () => {
  return (
    <RouterProvider>
      <ToastProvider>
        <AppToasts />
        <TeamProvider>
          <AppLayoutContent />
        </TeamProvider>
      </ToastProvider>
    </RouterProvider>
  );
};
