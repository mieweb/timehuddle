/**
 * AppLayout — Root shell for all authenticated app routes.
 *
 * Composes three primitives:
 *   • Sidebar     — collapsible, icon-only or full width, drawer on mobile
 *   • AppHeader   — sticky top bar with title, theme toggle, user menu
 *   • <main>      — scrollable content area
 *
 * RouterContext is the single source of truth for pathname so any descendant
 * can read the current route or navigate without prop-drilling or an external
 * router library.
 *
 * SidebarContext owns expand/collapse + mobile drawer state.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

import { ClockPage } from '../features/clock/ClockPage';
import { TimesheetPage } from '../features/clock/TimesheetPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { MessagesPage } from '../features/messages/MessagesPage';
import { NotificationsPage } from '../features/notifications/NotificationsPage';
import { ProfilePage } from '../features/profile/ProfilePage';
import { SeederPage } from '../features/seeder/SeederPage';
import { TeamsPage } from '../features/teams/TeamsPage';
import { TicketsPage } from '../features/tickets/TicketsPage';
import { TicketDetailPage } from '../features/tickets/TicketDetailPage';
import { WorkPage } from '../features/timers/WorkPage';
import { ActivityLogPage } from '../features/activity/ActivityLogPage';
import { MediaPage } from '../features/media/MediaPage';
import { OrganizationMembersPage } from '../features/org/OrganizationMembersPage';
import Huddle from '../pages/Huddle';
import { HiPage } from '../pages/HiPage';
import { OrganizationOverviewPage } from '../features/org/OrganizationOverviewPage';
import { OrganizationPage } from '../features/org/OrganizationPage';
import { EnterprisePage } from '../features/enterprise/EnterprisePage';
import { SIDEBAR_KEY, MESSAGES_PENDING_THREAD_KEY } from '../lib/constants';
import { TeamProvider, useTeam } from '../lib/TeamContext';
import { useBrand } from '../lib/useBrand';
import { useSession } from '../lib/useSession';
import { RefreshProvider } from '../lib/RefreshContext';
import { ShiftReminderProvider } from '../features/notifications/ShiftReminderContext';
import { FeedbackModal } from '../features/feedback/FeedbackModal';
import { ReportIssueModal } from '../features/feedback/ReportIssueModal';
import { AppHeader } from './AppHeader';
import { BottomNav } from './BottomNav';
import { CommandPalette } from './CommandPalette';
import { PullToRefresh } from './PullToRefresh';
import { RouterContext } from './router';
import { SettingsPage } from './SettingsPage';
import { Sidebar } from './Sidebar';

// ─── Router ───────────────────────────────────────────────────────────────────
export type { RouterCtx } from './router';
export { RouterContext, useRouter } from './router';

// ─── Route registry ───────────────────────────────────────────────────────────

interface RouteConfig {
  title: string;
  component: React.FC;
}

const ROUTES: Record<string, RouteConfig> = {
  '/app/admin/organization': { title: 'Organization Admin', component: OrganizationOverviewPage },

  '/app/activity': { title: 'Activity Log', component: ActivityLogPage },
  '/app/clock': { title: 'Clock In/Out', component: ClockPage },
  '/app/dashboard': { title: 'Dashboard', component: DashboardPage },
  '/app/hi': { title: 'Hi', component: HiPage },
  '/app/huddle': { title: 'Huddle', component: Huddle },
  '/app/messages': { title: 'Messages', component: MessagesPage },
  '/app/notifications': { title: 'Notifications', component: NotificationsPage },
  '/app/enterprise': { title: 'Enterprise', component: EnterprisePage },
  '/app/organization': { title: 'Organization', component: OrganizationPage },
  '/app/media': { title: 'Media Library', component: MediaPage },
  '/app/settings': { title: 'Settings', component: SettingsPage },
  ...(import.meta.env.MODE !== 'production'
    ? { '/app/seeder': { title: 'Seeder', component: SeederPage } }
    : {}),
  '/app/teams': { title: 'Teams', component: TeamsPage },
  '/app/tickets': { title: 'Tickets', component: TicketsPage },
  '/app/timesheet': { title: 'Timesheet', component: TimesheetPage },
  '/app/work': { title: 'Work', component: WorkPage },

  '/app/org/members': { title: 'Members', component: OrganizationMembersPage },
};

function match(pathname: string): RouteConfig | null {
  if (pathname.startsWith('/app/profile/')) return null;
  if (pathname.startsWith('/app/tickets/')) return null;
  return ROUTES[pathname] ?? ROUTES['/app/dashboard'];
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

export const MessagesActiveChatContext = createContext<{
  setHasActiveChat: (v: boolean) => void;
}>({ setHasActiveChat: () => {} });

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
  const { refetchTeams, refetchClock } = useTeam();

  useBrand();

  const normalizePath = (p: string) => (p === '/app' ? '/app/dashboard' : p);

  const [pathname, setPathname] = useState(() => {
    if (typeof window === 'undefined') return '/app/dashboard';
    const p = window.location.pathname;
    if (p === '/app') window.history.replaceState(null, '', '/app/dashboard');
    return normalizePath(p);
  });

  const navigate = useCallback((path: string) => {
    window.history.pushState(null, '', path);
    setPathname(path.split('?')[0]);
    window.dispatchEvent(new CustomEvent('timehuddle:navigate', { detail: { path } }));
  }, []);

  useEffect(() => {
    const onPop = () => setPathname(normalizePath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  // ── Shared notification data handler ──────────────────────────────────────
  const handleNotificationData = useCallback(
    (data: Record<string, string>) => {
      console.log('[handleNotificationData] received:', JSON.stringify(data));
      if (data.type === 'message' && data.teamId && data.adminId && data.memberId) {
        try {
          sessionStorage.setItem(
            MESSAGES_PENDING_THREAD_KEY,
            JSON.stringify({ teamId: data.teamId, adminId: data.adminId, memberId: data.memberId }),
          );
        } catch {
          /* ignore */
        }
        window.dispatchEvent(
          new CustomEvent('timehuddle:openThread', {
            detail: { teamId: data.teamId, adminId: data.adminId, memberId: data.memberId },
          }),
        );
        navigate('/app/messages');
      } else if (data.type === 'shift-end-reminder') {
        window.dispatchEvent(
          new CustomEvent('timehuddle:openShiftReminder', {
            detail: { clockEventId: data.clockEventId, teamId: data.teamId },
          }),
        );
      } else if (data.type === 'huddle-comment' || data.type === 'huddle-mention') {
        // Navigate to huddle page (future: scroll to specific post via postId)
        navigate('/app/huddle');
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

    // Check for notification tap that happened before JS bridge was ready (background/cold start)
    try {
      const raw = window.localStorage.getItem('pendingPushNotification');
      if (raw) {
        const data = JSON.parse(raw) as Record<string, string>;
        console.log('[PendingPush] found:', JSON.stringify(data));
        window.localStorage.removeItem('pendingPushNotification');
        handleNotificationData(data);
      }
    } catch {
      /* ignore */
    }

    // Background/closed tap → navigate directly
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      console.log('[ActionPerformed] data:', JSON.stringify(action.notification.data));
      handleNotificationData((action.notification.data ?? {}) as Record<string, string>);
    })
      .then((h) => handles.push(h))
      .catch(() => {});

    // Foreground push → iOS shows native banner via AppDelegate willPresent
    // Tap is handled by pushNotificationActionPerformed above
    PushNotifications.addListener('pushNotificationReceived', (_notification) => {
      // intentionally empty — iOS handles the banner natively
    })
      .then((h) => handles.push(h))
      .catch(() => {});

    return () => {
      handles.forEach((h) => h.remove());
    };
  }, [handleNotificationData]);

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
  // /app/profile/:id  — numeric/ObjectId user ID
  // /app/profile/:username — alphanumeric username (falls through from ID check)
  const profileSegment = pathname.startsWith('/app/profile/')
    ? pathname.slice('/app/profile/'.length)
    : null;
  const profileUserId =
    profileSegment && /^[a-f0-9]{24}$|^\d+$/.test(profileSegment) ? profileSegment : null;
  const profileUsername = profileSegment && !profileUserId ? profileSegment : null;

  const ticketDetailId =
    !profileSegment && pathname.startsWith('/app/tickets/')
      ? pathname.slice('/app/tickets/'.length)
      : null;

  const route = profileSegment || ticketDetailId ? null : match(pathname);
  const pageTitle = profileSegment
    ? 'Profile'
    : ticketDetailId
      ? 'Ticket'
      : (route?.title ?? 'App');
  const isMessagesPage = pathname === '/app/messages';

  const [messagesHasActiveChat, setMessagesHasActiveChat] = useState(false);
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
    <RouterContext.Provider value={{ pathname, navigate }}>
      <RefreshProvider globalRefreshHandlers={[refetchSession, refetchTeams, refetchClock]}>
        <CommandPalette />
        <ReportIssueModal open={reportIssueOpen} onClose={() => setReportIssueOpen(false)} />
        <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
        <ShiftReminderProvider>
          <AppFeedbackContext.Provider
            value={{
              openReportIssue: () => setReportIssueOpen(true),
              openFeedback: () => setFeedbackOpen(true),
            }}
          >
            <MessagesActiveChatContext.Provider
              value={{ setHasActiveChat: setMessagesHasActiveChat }}
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
                        className="fixed top-4 left-1/2 -translate-x-1/2 z-9999 w-[90%] max-w-sm
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
                    <AppHeader title={pageTitle} />
                    <main
                      ref={mainRef}
                      className={`flex-1 overflow-auto ${isMessagesPage ? `h-full ${messagesHasActiveChat ? 'pb-0' : 'app-main-scroll'}` : 'app-main-scroll'} md:pb-0`}
                    >
                      <PullToRefresh>
                        <div
                          className={
                            !profileSegment && !ticketDetailId && pathname === '/app/tickets'
                              ? 'h-full w-full flex flex-col'
                              : 'absolute w-0 h-0 overflow-hidden invisible pointer-events-none'
                          }
                        >
                          <TicketsPage />
                        </div>
                        {profileUserId ? (
                          <ProfilePage userId={profileUserId} />
                        ) : profileUsername ? (
                          <ProfilePage username={profileUsername} />
                        ) : ticketDetailId ? (
                          <TicketDetailPage ticketId={ticketDetailId} />
                        ) : (
                          route &&
                          route.component !== TicketsPage &&
                          React.createElement(route.component)
                        )}
                      </PullToRefresh>
                    </main>
                  </div>

                  {(!isMessagesPage || !messagesHasActiveChat) && <BottomNav />}
                </div>
              </SidebarContext.Provider>
            </MessagesActiveChatContext.Provider>
          </AppFeedbackContext.Provider>
        </ShiftReminderProvider>
      </RefreshProvider>
    </RouterContext.Provider>
  );
};

// ─── AppLayout (Team wrapper) ─────────────────────────────────────────────────

export const AppLayout: React.FC = () => {
  return (
    <TeamProvider>
      <AppLayoutContent />
    </TeamProvider>
  );
};
