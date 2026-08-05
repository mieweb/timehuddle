/**
 * AppHeader — Sticky top bar.
 *
 * Left  : org/team switcher
 * Right : clock-in timer (if active), clock page shortcut button,
 *         notifications bell, UserDropdown
 *
 * The page title lives in the body, not here — see ui/pageTitle.tsx.
 */
import { faBell, faClock } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button } from '@mieweb/ui';
import React from 'react';

import { useTeam } from '../lib/TeamContext';
import { ClockInHeaderTimer } from './ClockInHeaderTimer';
import { OrgTeamSwitcher } from './OrgTeamSwitcher';
import { useRouter } from './router';
import { UserDropdown } from './UserDropdown';

export const AppHeader: React.FC = () => {
  const { navigate, pathname } = useRouter();
  const { activeClockEvent } = useTeam();
  const onClockPage = pathname.startsWith('/app/clock');

  return (
    <header className="app-header sticky top-0 z-40 flex shrink-0 flex-col justify-end border-b border-neutral-200 bg-white/85 backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-900/85">
      <div className="flex h-16 items-center justify-between gap-4 px-4">
        {/* ── Left ── */}
        <div className="flex min-w-0 items-center gap-3">
          {/* Current org/team scope */}
          <OrgTeamSwitcher />
        </div>

        {/* ── Right ── */}
        <div className="flex shrink-0 items-center gap-2">
          {/* Clock-in timer (visible when clocked in) */}
          <ClockInHeaderTimer />
          {/* Direct shortcut to the clock page — desktop only; mobile already
              has the Clock In tab/FAB in BottomNav. Hidden while already on
              the clock page (its own Clock In/Out button covers that, and
              duplicating the accessible name breaks role-based selectors). */}
          {!onClockPage && (
            <Button
              variant={activeClockEvent ? 'ghost' : 'secondary'}
              size={activeClockEvent ? 'icon' : 'sm'}
              onClick={() => navigate('/app/clock')}
              aria-label={activeClockEvent ? 'Go to clock page' : 'Clock in'}
              title={activeClockEvent ? 'Go to clock page' : 'Clock in'}
              className="hidden sm:inline-flex"
              leftIcon={
                activeClockEvent ? undefined : (
                  <FontAwesomeIcon icon={faClock} className="text-xs" />
                )
              }
            >
              {activeClockEvent ? <FontAwesomeIcon icon={faClock} /> : 'Clock In'}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/app/notifications')}
            aria-label="Notifications"
            title="Notifications"
          >
            <FontAwesomeIcon icon={faBell} />
          </Button>
          <UserDropdown />
        </div>
      </div>
    </header>
  );
};
