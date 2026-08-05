/**
 * BottomNav — Mobile-only bottom navigation bar.
 *
 * Visible only on small screens (md:hidden).
 * Five tabs: Dashboard, Huddle, Clock In/Out (center FAB), Tickets, More.
 * "More" opens a sheet with the remaining sidebar destinations (Teams,
 * Organization, Work, Media Library, Messages, Activity Log, Profile,
 * Settings) so every sidebar link stays reachable on mobile without a
 * hamburger drawer. Notifications is not among them — the header's bell
 * icon is present at every width.
 * Active tab indicator is an animated bubble that glides between positions.
 * FAB uses CSS brand tokens so it follows brand/theme changes automatically.
 * The FAB navigates to the clock page (rather than toggling directly) so the
 * plan-first gates and their inline composer are always visible.
 */
import {
  faBug,
  faBuilding,
  faChevronLeft,
  faCircleStop,
  faCircleUser,
  faClock,
  faClockRotateLeft,
  faComments,
  faEllipsis,
  faEnvelope,
  faGauge,
  faGear,
  faCircleQuestion,
  faListCheck,
  faPhotoFilm,
  faSitemap,
  faStopwatch,
  faUsers,
  faWrench,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { faApple } from '@fortawesome/free-brands-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import React, { useState } from 'react';

import { hasDefaultOrganizationAdminAccess } from '../lib/organizationAccess';
import { useTeam } from '../lib/TeamContext';
import { useClockToggle } from '../lib/useClockToggle';
import { useSession } from '../lib/useSession';
import { useAppFeedback } from './AppLayout';
import { useRouter } from './router';

// Update this URL once the TestFlight build is published in App Store Connect.
const TESTFLIGHT_URL = 'https://testflight.apple.com/join/45w2knYf';

interface NavTab {
  icon: typeof faGauge;
  label: string;
  href: string;
  isFab?: boolean;
  isMore?: boolean;
}

const TABS: NavTab[] = [
  { icon: faGauge, label: 'Home', href: '/app/dashboard' },
  { icon: faComments, label: 'Huddle', href: '/app/huddle' },
  { icon: faClock, label: 'Clock In', href: '/app/clock', isFab: true },
  { icon: faListCheck, label: 'Tickets', href: '/app/tickets' },
  { icon: faEllipsis, label: 'More', href: '', isMore: true },
];

interface MoreItem {
  icon: typeof faGauge;
  label: string;
  href: string;
}

const MORE_ITEMS: MoreItem[] = [
  { icon: faUsers, label: 'Teams', href: '/app/teams' },
  { icon: faSitemap, label: 'Organization', href: '/app/organization' },
  { icon: faCircleUser, label: 'Profile', href: '/app/settings' },
  { icon: faStopwatch, label: 'Work', href: '/app/work' },
  { icon: faPhotoFilm, label: 'Media Library', href: '/app/media' },
  { icon: faEnvelope, label: 'Messages', href: '/app/messages' },
  { icon: faClockRotateLeft, label: 'Activity Log', href: '/app/activity' },
  { icon: faGear, label: 'Settings', href: '/app/settings' },
];

/** Sub-sections of the More sheet — grouped destinations from the desktop
 *  account menu (Admin/Developers/Help) that drill down into a row list
 *  instead of navigating away immediately. */
type MoreSection = 'root' | 'admin' | 'developers' | 'help';

interface MoreRow {
  icon: typeof faGauge;
  label: string;
  onClick: () => void;
}

export const BottomNav: React.FC = () => {
  const { pathname, navigate } = useRouter();
  const { isClockedIn, planGate } = useClockToggle();
  const { user } = useSession();
  const { enterprises } = useTeam();
  const { openFeedback, openReportIssue } = useAppFeedback();
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreSection, setMoreSection] = useState<MoreSection>('root');

  React.useEffect(() => {
    if (!moreOpen) return undefined;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = original;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [moreOpen]);

  const openMore = () => {
    setMoreSection('root');
    setMoreOpen(true);
  };
  const closeMore = () => {
    setMoreOpen(false);
    setMoreSection('root');
  };
  const goToMoreItem = (href: string) => {
    closeMore();
    navigate(href);
  };
  const goToProfile = () => {
    closeMore();
    navigate(user?.username ? `/app/profile/${user.username}` : '/app/settings');
  };

  const showAdmin = hasDefaultOrganizationAdminAccess(user) || enterprises.length > 0;
  const showDevelopers = import.meta.env.MODE !== 'production';

  const adminRows: MoreRow[] = [
    ...(enterprises.length > 0
      ? [{ icon: faBuilding, label: 'Enterprise', onClick: () => goToMoreItem('/app/enterprise') }]
      : []),
    { icon: faUsers, label: 'Members', onClick: () => goToMoreItem('/app/org/members') },
  ];
  const developerRows: MoreRow[] = [
    { icon: faWrench, label: 'Seeder', onClick: () => goToMoreItem('/app/seeder') },
  ];
  const helpRows: MoreRow[] = [
    {
      icon: faBug,
      label: 'Report an Issue',
      onClick: () => {
        closeMore();
        openReportIssue();
      },
    },
    {
      icon: faComments,
      label: 'Share Your Feedback',
      onClick: () => {
        closeMore();
        openFeedback();
      },
    },
    {
      icon: faApple,
      label: 'TestFlight',
      onClick: () => {
        closeMore();
        window.open(TESTFLIGHT_URL, '_blank', 'noopener,noreferrer');
      },
    },
  ];

  const SECTION_CONFIG: Record<Exclude<MoreSection, 'root'>, { label: string; rows: MoreRow[] }> = {
    admin: { label: 'Admin', rows: adminRows },
    developers: { label: 'Developers', rows: developerRows },
    help: { label: 'Help', rows: helpRows },
  };

  // Plan-first gate: the FAB always navigates to the clock page (where the
  // inline composer lives) in full color — it's a link, not a disabled
  // control, so it never dims even when today's plan/wrap-up is still needed.
  const planBlocked = planGate.planMissing || planGate.wrapUpMissing;

  return (
    <MotionConfig transition={{ type: 'spring', damping: 26, stiffness: 300 }}>
      <nav
        className="bottom-nav fixed bottom-0 left-0 right-0 z-40 flex items-end justify-around border-t border-neutral-200 bg-white px-2 dark:border-neutral-800 dark:bg-neutral-900 md:hidden"
        aria-label="Bottom navigation"
      >
        {TABS.map((tab) => {
          const isActive =
            pathname === tab.href || (tab.href === '/app/dashboard' && pathname === '/app');

          if (tab.isFab) {
            return (
              <button
                key={tab.href}
                type="button"
                onClick={() => navigate(tab.href)}
                aria-label={
                  isClockedIn
                    ? planBlocked
                      ? 'Clock Out — wrap-up required'
                      : 'Clock Out'
                    : planBlocked
                      ? 'Clock In — plan required'
                      : 'Clock In'
                }
                aria-pressed={isClockedIn}
                className="relative -top-4 flex h-16 w-16 flex-col items-center justify-center rounded-full shadow-lg transition-transform active:scale-95 disabled:opacity-60"
                style={{
                  background: isClockedIn
                    ? 'linear-gradient(135deg, #f87171, #dc2626)'
                    : 'linear-gradient(135deg, var(--color-primary-400, #60a5fa), var(--color-primary-600, #2563eb))',
                  boxShadow: isClockedIn
                    ? '0 4px 18px 0 rgb(220 38 38 / 45%)'
                    : '0 4px 18px 0 color-mix(in srgb, var(--color-primary, #3b82f6) 45%, transparent)',
                }}
              >
                <FontAwesomeIcon
                  icon={isClockedIn ? faCircleStop : tab.icon}
                  className="text-xl text-white"
                />
                <span className="mt-0.5 text-[9px] font-medium text-white/90">
                  {isClockedIn ? 'Clock Out' : 'Clock In'}
                </span>
              </button>
            );
          }

          return (
            <button
              key={tab.href || tab.label}
              type="button"
              onClick={tab.isMore ? openMore : () => navigate(tab.href)}
              aria-label={tab.label}
              aria-current={isActive ? 'page' : undefined}
              aria-haspopup={tab.isMore ? 'dialog' : undefined}
              className={[
                'relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs transition-colors',
                isActive
                  ? 'text-primary-600 dark:text-primary-400'
                  : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200',
              ].join(' ')}
            >
              {/* Animated bubble behind the active icon */}
              {isActive && (
                <motion.span
                  layoutId="bottom-nav-bubble"
                  className="absolute inset-x-1 inset-y-1 rounded-xl"
                  style={{
                    background:
                      'color-mix(in srgb, var(--color-primary, #3b82f6) 12%, transparent)',
                  }}
                />
              )}
              <FontAwesomeIcon icon={tab.icon} className="relative text-lg" />
              <span className="relative text-[10px] font-medium">{tab.label}</span>
            </button>
          );
        })}
      </nav>

      <AnimatePresence>
        {moreOpen && (
          <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="More">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 bg-black/40"
              onClick={closeMore}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="absolute inset-x-0 bottom-0 flex max-h-[88vh] flex-col rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-xl dark:bg-neutral-900"
            >
              <div className="flex shrink-0 items-center gap-2 border-b border-neutral-100 px-5 py-4 dark:border-neutral-800">
                {moreSection !== 'root' && (
                  <button
                    type="button"
                    onClick={() => setMoreSection('root')}
                    aria-label="Back"
                    className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    <FontAwesomeIcon icon={faChevronLeft} />
                  </button>
                )}
                <h2 className="flex-1 font-semibold text-neutral-900 dark:text-neutral-100">
                  {moreSection === 'root' ? 'More' : SECTION_CONFIG[moreSection].label}
                </h2>
                <button
                  type="button"
                  onClick={closeMore}
                  aria-label="Close"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              </div>
              <div className="overflow-y-auto px-5 py-4">
                {moreSection === 'root' ? (
                  <div className="grid grid-cols-3 gap-3">
                    {MORE_ITEMS.map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        onClick={
                          item.label === 'Profile' ? goToProfile : () => goToMoreItem(item.href)
                        }
                        className="flex flex-col items-center gap-1.5 rounded-xl bg-neutral-50 py-4 text-neutral-700 transition-colors hover:bg-neutral-100 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                      >
                        <FontAwesomeIcon icon={item.icon} className="text-xl" />
                        <span className="text-xs font-medium">{item.label}</span>
                      </button>
                    ))}
                    {showAdmin && (
                      <button
                        type="button"
                        onClick={() => setMoreSection('admin')}
                        className="flex flex-col items-center gap-1.5 rounded-xl bg-neutral-50 py-4 text-neutral-700 transition-colors hover:bg-neutral-100 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                      >
                        <FontAwesomeIcon icon={faBuilding} className="text-xl" />
                        <span className="text-xs font-medium">Admin</span>
                      </button>
                    )}
                    {showDevelopers && (
                      <button
                        type="button"
                        onClick={() => setMoreSection('developers')}
                        className="flex flex-col items-center gap-1.5 rounded-xl bg-neutral-50 py-4 text-neutral-700 transition-colors hover:bg-neutral-100 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                      >
                        <FontAwesomeIcon icon={faWrench} className="text-xl" />
                        <span className="text-xs font-medium">Developers</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setMoreSection('help')}
                      className="flex flex-col items-center gap-1.5 rounded-xl bg-neutral-50 py-4 text-neutral-700 transition-colors hover:bg-neutral-100 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                    >
                      <FontAwesomeIcon icon={faCircleQuestion} className="text-xl" />
                      <span className="text-xs font-medium">Help</span>
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {SECTION_CONFIG[moreSection].rows.map((row) => (
                      <button
                        key={row.label}
                        type="button"
                        onClick={row.onClick}
                        className="flex items-center gap-3 rounded-lg px-3 py-3 text-left text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
                      >
                        <FontAwesomeIcon icon={row.icon} className="w-5 text-base" />
                        <span className="text-sm font-medium">{row.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
};
