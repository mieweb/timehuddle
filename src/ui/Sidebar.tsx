/**
 * Sidebar — Collapsible app navigation.
 *
 * Desktop rail (md+): fixed width panel, animates between 240 px (expanded) and
 * 64 px (collapsed / icon-only) using a spring. Collapse control lives in the
 * rail footer.
 *
 * On mobile (< md) the rail is hidden entirely — every sidebar destination is
 * reachable via the bottom nav's More sheet instead of a hamburger drawer.
 *
 * Labels fade in/out with AnimatePresence on the rail so they never clip during resize.
 */
import {
  faChevronLeft,
  faChevronRight,
  faClock,
  faBell,
  faComments,
  faEnvelope,
  faGauge,
  faListCheck,
  faPhotoFilm,
  faSitemap,
  faStopwatch,
  faTable,
  faUsers,
  faClockRotateLeft,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import React, { useEffect, useState } from 'react';

import { notificationApi } from '../lib/api';

// Detect page reload once at module load time (before React mounts).
// Only suppresses animations during the initial reload render — normal
// expand/collapse interactions animate as usual afterwards.
const isReload = (() => {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    return nav?.type === 'reload';
  } catch {
    return false;
  }
})();

import { useSidebar } from './AppLayout';
import { Logo } from './Logo';
import { useRouter } from './router';

// ─── Nav data ─────────────────────────────────────────────────────────────────

interface NavItem {
  icon: typeof faGauge;
  label: string;
  href: string;
  external?: boolean;
}

interface NavSection {
  heading?: string;
  items: NavItem[];
}

const NAV: NavSection[] = [
  {
    heading: 'Workspace',
    items: [
      { icon: faGauge, label: 'Dashboard', href: '/app/dashboard' },
      { icon: faComments, label: 'Huddle', href: '/app/huddle' },
      { icon: faClock, label: 'Clock', href: '/app/clock' },
      { icon: faListCheck, label: 'Tickets', href: '/app/tickets' },
      { icon: faTable, label: 'Timesheet', href: '/app/timesheet' },
      { icon: faStopwatch, label: 'Work', href: '/app/work' },
    ],
  },
  {
    heading: 'Manage',
    items: [
      { icon: faUsers, label: 'Teams', href: '/app/teams' },
      { icon: faSitemap, label: 'Organization', href: '/app/organization' },
      { icon: faPhotoFilm, label: 'Media Library', href: '/app/media' },
      { icon: faEnvelope, label: 'Messages', href: '/app/messages' },
      { icon: faBell, label: 'Notifications', href: '/app/notifications' },
      { icon: faClockRotateLeft, label: 'Activity Log', href: '/app/activity' },
    ],
  },
];

type SidebarContentVariant = 'rail' | 'drawer';

interface SidebarContentProps {
  variant?: SidebarContentVariant;
}

// ─── NavLink ─────────────────────────────────────────────────────────────────

const NavLink: React.FC<{ item: NavItem; active: boolean; expanded: boolean }> = ({
  item,
  active,
  expanded,
}) => {
  const { navigate } = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (item.external) {
          window.open(item.href, '_blank', 'noopener,noreferrer');
        } else {
          navigate(item.href);
        }
      }}
      className={[
        'group flex h-9 w-full items-center rounded-lg text-sm transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-(--mieweb-primary-500)/40',
        expanded ? 'gap-3 px-2.5' : 'justify-center px-0',
        active
          ? 'bg-primary-50 text-primary-700 dark:bg-primary-950/60 dark:text-primary-400'
          : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800',
      ].join(' ')}
      aria-current={active ? 'page' : undefined}
      title={!expanded ? item.label : undefined}
    >
      <FontAwesomeIcon
        icon={item.icon}
        className={[
          'w-4 shrink-0 text-sm',
          active
            ? 'text-primary-600 dark:text-primary-400'
            : 'text-neutral-400 transition-colors group-hover:text-neutral-700 dark:group-hover:text-neutral-200',
        ].join(' ')}
      />
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.span
            key="label"
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.15, ease: 'easeInOut' }}
            className="overflow-hidden whitespace-nowrap"
          >
            {item.label}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
};

// ─── SidebarContent ───────────────────────────────────────────────────────────

const SidebarContent: React.FC<SidebarContentProps> = ({ variant = 'rail' }) => {
  const { isExpanded, toggle } = useSidebar();
  const { pathname } = useRouter();
  const expanded = variant === 'drawer' ? true : isExpanded;

  // Native build/version (what TestFlight shows) via App.getInfo(). Falls
  // back to the web build's version (baked in at build time) when not
  // running natively, so the row always has something to show.
  const [appInfo, setAppInfo] = useState<{ version: string; build: string } | null>(null);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    App.getInfo()
      .then(({ version, build }) => setAppInfo({ version, build }))
      .catch(() => {});
  }, []);
  const versionLabel = appInfo
    ? `v${appInfo.version} (${appInfo.build})`
    : `v${import.meta.env.VITE_APP_VERSION || '1.0.0'}`;

  const [testPushLoading, setTestPushLoading] = useState(false);
  const handleTestPush = async () => {
    setTestPushLoading(true);
    try {
      await notificationApi.testPush();
      window.alert(
        Capacitor.isNativePlatform()
          ? 'Test push sent! You should receive a notification on this device.'
          : 'Test push sent! You should see a browser notification within a few seconds.',
      );
    } catch (err) {
      window.alert(`Failed to send test push: ${err instanceof Error ? err.message : err}`);
    } finally {
      setTestPushLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Logo / brand */}
      <div
        className={[
          'sidebar-brand flex shrink-0 items-center border-b border-neutral-200 px-3 dark:border-neutral-800',
          expanded ? '' : 'justify-center',
        ].join(' ')}
        style={{ minHeight: '4rem' }}
      >
        {' '}
        <span className="flex min-w-0 items-center gap-3 rounded-md" aria-label="Huddle">
          {/* Icon mark */}
          <Logo />
          {/* Wordmark */}
          <AnimatePresence initial={false}>
            {expanded && (
              <motion.div
                key="wordmark"
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.15, ease: 'easeInOut' }}
                className="overflow-hidden"
              >
                <p className="whitespace-nowrap text-sm font-semibold leading-none tracking-tight text-neutral-900 dark:text-neutral-100">
                  Huddle
                </p>
                <p className="mt-0.5 whitespace-nowrap text-[10px] text-neutral-400 dark:text-neutral-500">
                  Team Collaboration
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-4" aria-label="Main navigation">
        {NAV.map((section, si) => (
          <div key={si}>
            {/* Section heading — only shown when expanded */}
            <AnimatePresence initial={false}>
              {expanded && section.heading && (
                <motion.p
                  key="heading"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.15 }}
                  className="mb-1 overflow-hidden px-2.5 text-[10px] font-semibold uppercase tracking-widest text-neutral-400 dark:text-neutral-500"
                >
                  {section.heading}
                </motion.p>
              )}
            </AnimatePresence>
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.label}>
                  <NavLink item={item} active={pathname === item.href} expanded={expanded} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* App info + test push — bottom of sidebar */}
      <div className="shrink-0 space-y-2 border-t border-neutral-200 px-2 py-3 dark:border-neutral-800">
        {expanded && (
          <p className="px-2.5 text-[10px] text-neutral-400 dark:text-neutral-500">
            {versionLabel}
          </p>
        )}
        <button
          type="button"
          onClick={handleTestPush}
          disabled={testPushLoading}
          title={!expanded ? 'Send test push notification' : undefined}
          className={[
            'flex h-9 w-full items-center rounded-lg text-sm text-neutral-500 transition-colors hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-800',
            expanded ? 'gap-3 px-2.5' : 'justify-center px-0',
          ].join(' ')}
        >
          <FontAwesomeIcon icon={faBell} className="w-4 shrink-0 text-sm" />
          <AnimatePresence initial={false}>
            {expanded && (
              <motion.span
                key="test-push-label"
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.15, ease: 'easeInOut' }}
                className="overflow-hidden whitespace-nowrap"
              >
                {testPushLoading ? 'Sending…' : 'Test push notification'}
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>

      {variant === 'rail' && (
        <div className="shrink-0 space-y-0.5 border-t border-neutral-200 px-2 py-3 dark:border-neutral-800">
          <button
            type="button"
            onClick={toggle}
            title={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
            aria-label={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
            className={[
              'flex h-9 w-full items-center rounded-lg text-sm text-neutral-500 transition-colors hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800',
              isExpanded ? 'gap-3 px-2.5' : 'justify-center px-0',
            ].join(' ')}
          >
            <FontAwesomeIcon
              icon={isExpanded ? faChevronLeft : faChevronRight}
              className="w-4 shrink-0 text-xs"
            />
            <AnimatePresence initial={false}>
              {isExpanded && (
                <motion.span
                  key="collapse-label"
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={{ duration: 0.15, ease: 'easeInOut' }}
                  className="overflow-hidden whitespace-nowrap"
                >
                  Collapse
                </motion.span>
              )}
            </AnimatePresence>
          </button>
        </div>
      )}
    </div>
  );
};

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export const Sidebar: React.FC = () => {
  const { isExpanded } = useSidebar();

  return (
    <MotionConfig transition={isReload ? { duration: 0 } : undefined}>
      {/* Desktop: animated-width panel. The mobile drawer was removed — all
          sidebar destinations are reachable via the bottom nav's More sheet. */}
      <motion.aside
        className="hidden h-full shrink-0 flex-col overflow-hidden border-r border-neutral-200 bg-white md:flex dark:border-neutral-800 dark:bg-neutral-900"
        animate={{ width: isExpanded ? 240 : 64 }}
        transition={isReload ? { duration: 0 } : { type: 'spring', damping: 28, stiffness: 280 }}
      >
        <SidebarContent variant="rail" />
      </motion.aside>
    </MotionConfig>
  );
};
