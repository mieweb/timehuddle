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
import { TeamsPage } from '../features/teams/TeamsPage';
import { TicketsPage } from '../features/tickets/TicketsPage';
import { TicketDetailPage } from '../features/tickets/TicketDetailPage';
import { WorkPage } from '../features/timers/WorkPage';
import { OzwellWidget } from '../features/ai/OzwellWidget';
import { ActivityLogPage } from '../features/activity/ActivityLogPage';
import { OrganizationMembersPage } from '../features/org/OrganizationMembersPage';
import { OrganizationOverviewPage } from '../features/org/OrganizationOverviewPage';
import { OrganizationPage } from '../features/org/OrganizationPage';
import { SIDEBAR_KEY, MESSAGES_PENDING_THREAD_KEY } from '../lib/constants';
import { TeamProvider } from '../lib/TeamContext';
import { useBrand } from '../lib/useBrand';
import { FeedbackModal } from '../features/feedback/FeedbackModal';
import { ReportIssueModal } from '../features/feedback/ReportIssueModal';
import { AppHeader } from './AppHeader';
import { BottomNav } from './BottomNav';
import { CommandPalette } from './CommandPalette';
import { RouterContext } from './router';
import { SettingsPage } from './SettingsPage';
import { Sidebar } from './Sidebar';

// ─── Router ───────────────────────────────────────────────────────────────────
// RouterCtx, RouterContext and useRouter are defined in ./router.ts
// Re-exported here so existing imports from AppLayout continue to work.
export type { RouterCtx } from './router';
export { RouterContext, useRouter } from './router';

// ─── Route registry ───────────────────────────────────────────────────────────

interface RouteConfig {
  title: string;
  component: React.FC;
}

const ROUTES: Record<string, RouteConfig> = {
  '/app/dashboard': { title: 'Dashboard', component: DashboardPage },
  '/app/clock': { title: 'Clock In/Out', component: ClockPage },
  '/app/tickets': { title: 'Tickets', component: TicketsPage },
  '/app/work': { title: 'Work', component: WorkPage },
  '/app/timesheet': { title: 'Timesheet', component: TimesheetPage },
  '/app/teams': { title: 'Teams', component: TeamsPage },
  '/app/organization': { title: 'Organization', component: OrganizationPage },
  '/app/messages': { title: 'Messages', component: MessagesPage },
  '/app/notifications': { title: 'Notifications', component: NotificationsPage },
  '/app/activity': { title: 'Activity Log', component: ActivityLogPage },
  '/app/admin/organization': { title: 'Organization Admin', component: OrganizationOverviewPage },
  '/org/members': { title: 'Members', component: OrganizationMembersPage },
  '/app/settings': { title: 'Settings', component: SettingsPage },
};

function match(pathname: string): RouteConfig | null {
  if (pathname.startsWith('/app/profile/')) return null; // parameterized — rendered separately
  if (pathname.startsWith('/app/tickets/')) return null; // parameterized — rendered separately
  if (/^\/[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/.test(pathname)) return null; // /:username — rendered separately
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

// ─── Messages active-chat context ─────────────────────────────────────────────
// MessagesPage calls setHasActiveChat(true/false) so AppLayout knows whether
// a channel/DM is open — hiding BottomNav only while chatting.
export const MessagesActiveChatContext = createContext<{
  setHasActiveChat: (v: boolean) => void;
}>({ setHasActiveChat: () => {} });

// ─── App Feedback context ────────────────────────────────────────────────────
// Modals render here at the root so they escape AppHeader's backdrop-filter
// containing block. Sidebar triggers both via this context.
export const AppFeedbackContext = createContext<{
  openReportIssue: () => void;
  openFeedback: () => void;
}>({ openReportIssue: () => {}, openFeedback: () => {} });

export const useAppFeedback = () => useContext(AppFeedbackContext);

// ─── AppLayout ────────────────────────────────────────────────────────────────

export const AppLayout: React.FC = () => {
  // Apply the saved brand/color theme on every mount, not just on SettingsPage
  useBrand();
  // ── Routing ──
  // Normalize legacy /app root to /app/todos so the sidebar item is always active
  const normalizePath = (p: string) => (p === '/app' ? '/app/dashboard' : p);

  const [pathname, setPathname] = useState(() => {
    if (typeof window === 'undefined') return '/app/dashboard';
    const p = window.location.pathname;
    if (p === '/app') window.history.replaceState(null, '', '/app/dashboard');
    return normalizePath(p);
  });

  const navigate = useCallback((path: string) => {
    window.history.pushState(null, '', path);
    setPathname(path);
  }, []);

  // Keep in sync with browser back/forward
  useEffect(() => {
    const onPop = () => setPathname(normalizePath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Scroll the content area back to the top on every route change
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  // Native push notification tap → navigate to the relevant page
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let handle: { remove: () => void } | null = null;
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const data = (action.notification.data ?? {}) as Record<string, string>;
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
      } else if (data.url) {
        const safePath = data.url.split('?')[0];
        if (safePath.startsWith('/app/')) {
          navigate(safePath);
        }
      }
    })
      .then((h) => {
        handle = h;
      })
      .catch(() => {
        /* PushNotifications unavailable */
      });
    return () => {
      handle?.remove();
    };
  }, [navigate]);

  // Parameterized profile route — /app/profile/:userId
  const profileUserId = pathname.startsWith('/app/profile/')
    ? pathname.slice('/app/profile/'.length)
    : null;

  // Parameterized ticket detail route — /app/tickets/:id
  const ticketDetailId =
    !profileUserId && pathname.startsWith('/app/tickets/')
      ? pathname.slice('/app/tickets/'.length)
      : null;

  // Public profile route — /:username
  const profileUsername =
    !profileUserId && /^\/[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/.test(pathname)
      ? pathname.slice(1)
      : null;

  const route = profileUserId || profileUsername || ticketDetailId ? null : match(pathname);
  const pageTitle =
    profileUserId || profileUsername
      ? 'Profile'
      : ticketDetailId
        ? 'Ticket'
        : (route?.title ?? 'App');
  const isMessagesPage = pathname === '/app/messages';

  // ── Messages active-chat state (set by MessagesPage via context) ──
  const [messagesHasActiveChat, setMessagesHasActiveChat] = useState(false);

  // ── Report Issue modal state ──
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
      <TeamProvider>
        <CommandPalette />
        <ReportIssueModal open={reportIssueOpen} onClose={() => setReportIssueOpen(false)} />
        <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
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
                {/* Mobile backdrop — rendered via portal to escape overflow-hidden */}
                {isMobileOpen &&
                  createPortal(
                    <div
                      className="fixed inset-0 z-45 bg-black/50 backdrop-blur-sm md:hidden"
                      onClick={closeMobile}
                      aria-hidden
                    />,
                    document.body,
                  )}

                <Sidebar />

                {/* Content column */}
                <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                  <AppHeader title={pageTitle} />
                  <main
                    ref={mainRef}
                    className={`flex-1 overflow-auto ${isMessagesPage ? `h-full ${messagesHasActiveChat ? 'pb-0' : 'pb-20'}` : 'pb-20'} md:pb-0`}
                  >
                    {profileUserId ? (
                      <ProfilePage userId={profileUserId} />
                    ) : profileUsername ? (
                      <ProfilePage username={profileUsername} />
                    ) : ticketDetailId ? (
                      <TicketDetailPage ticketId={ticketDetailId} />
                    ) : (
                      route && React.createElement(route.component)
                    )}
                  </main>
                </div>

                {(!isMessagesPage || !messagesHasActiveChat) && <BottomNav />}
              </div>
            </SidebarContext.Provider>
            <OzwellWidget />
          </MessagesActiveChatContext.Provider>
        </AppFeedbackContext.Provider>
      </TeamProvider>
    </RouterContext.Provider>
  );
};
