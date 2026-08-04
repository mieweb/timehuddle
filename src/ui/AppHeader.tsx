/**
 * AppHeader — Sticky top bar.
 *
 * Left  : org/team switcher
 * Right : clock-in timer (if active), notifications bell, UserDropdown
 *
 * The page title lives in the body, not here — see ui/pageTitle.tsx.
 */
import { faBell } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button } from '@mieweb/ui';
import React from 'react';

import { ClockInHeaderTimer } from './ClockInHeaderTimer';
import { OrgTeamSwitcher } from './OrgTeamSwitcher';
import { useRouter } from './router';
import { UserDropdown } from './UserDropdown';

export const AppHeader: React.FC = () => {
  const { navigate } = useRouter();

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
