/**
 * BottomNav — Mobile-only bottom navigation bar.
 *
 * Visible only on small screens (md:hidden).
 * Five tabs: Dashboard, Tickets, Clock In/Out (center FAB), Teams, Settings.
 * Active tab indicator is an animated bubble that glides between positions.
 * FAB uses CSS brand tokens so it follows brand/theme changes automatically.
 */
import {
  faCircleStop,
  faClock,
  faGauge,
  faGear,
  faListCheck,
  faUsers,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { motion, MotionConfig } from 'motion/react';
import React, { useCallback } from 'react';

import { useClockToggle } from '../lib/useClockToggle';
import { useRouter } from './router';

interface NavTab {
  icon: typeof faGauge;
  label: string;
  href: string;
  isFab?: boolean;
}

const TABS: NavTab[] = [
  { icon: faGauge, label: 'Home', href: '/app/dashboard' },
  { icon: faListCheck, label: 'Tickets', href: '/app/tickets' },
  { icon: faClock, label: 'Clock In', href: '/app/clock', isFab: true },
  { icon: faUsers, label: 'Teams', href: '/app/teams' },
  { icon: faGear, label: 'Settings', href: '/app/settings' },
];

export const BottomNav: React.FC = () => {
  const { pathname, navigate } = useRouter();
  const { isClockedIn, clockIn, clockOut, clockInLoading, clockOutLoading } = useClockToggle();

  const clockLoading = clockInLoading || clockOutLoading;

  const handleClockToggle = useCallback(async () => {
    try {
      if (isClockedIn) {
        await clockOut();
      } else {
        await clockIn();
      }
    } catch {
      navigate('/app/clock');
    }
  }, [isClockedIn, clockIn, clockOut, navigate]);

  return (
    <MotionConfig transition={{ type: 'spring', damping: 26, stiffness: 300 }}>
      <nav
        className="bottom-nav fixed bottom-0 left-0 right-0 z-40 flex items-end justify-around border-t border-neutral-200 bg-white px-2 dark:border-neutral-800 dark:bg-neutral-900 md:hidden"
        aria-label="Bottom navigation"
      >
        {TABS.map((tab) => {
          const isActive =
            pathname === tab.href ||
            (tab.href === '/app/dashboard' && pathname === '/app');

          if (tab.isFab) {
            return (
              <button
                key={tab.href}
                type="button"
                onClick={handleClockToggle}
                disabled={clockLoading}
                aria-label={isClockedIn ? 'Clock Out' : 'Clock In'}
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
              key={tab.href}
              type="button"
              onClick={() => navigate(tab.href)}
              aria-label={tab.label}
              aria-current={isActive ? 'page' : undefined}
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
    </MotionConfig>
  );
};
