/**
 * AppHeader — Sticky top bar.
 *
 * Left  : org/team switcher
 * Right : clock controls, notifications bell, UserDropdown
 *
 * The clock controls swap on state so the primary action is always the
 * obvious one:
 *   • clocked out — a filled "Clock In" pill that reads as the call to action
 *   • clocked in  — a gradient strand travelling across the bar (desktop, the
 *     one place its helix detail is legible), the live timer (tap for the clock
 *     page) and Break/Resume
 *
 * Both are withheld on the clock page itself, which carries its own larger
 * versions of the same controls; duplicating their accessible names would also
 * break role-based selectors.
 *
 * The page title lives in the body, not here — see ui/pageTitle.tsx.
 */
import { faBell, faClock, faMugHot, faPlay } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button } from '@mieweb/ui';
import React from 'react';

import { useTeam } from '../lib/TeamContext';
import { useClockBreak } from '../lib/useClockBreak';
import { ClockInHeaderTimer } from './ClockInHeaderTimer';
import { OrgTeamSwitcher } from './OrgTeamSwitcher';
import { useRouter } from './router';
import { UserDropdown } from './UserDropdown';

export const AppHeader: React.FC = () => {
  const { navigate, pathname } = useRouter();
  const { activeClockEvent } = useTeam();
  const { isPaused, toggleBreak, clockPauseLoading } = useClockBreak();
  const onClockPage = pathname.startsWith('/app/clock');
  const isClockedIn = !!activeClockEvent;

  return (
    <header className="app-header sticky top-0 z-40 flex shrink-0 flex-col justify-end border-b border-neutral-200 bg-white/85 backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-900/85">
      <div className="flex h-16 items-center justify-between gap-4 px-4">
        {/* ── Left ── */}
        <div className="flex min-w-0 items-center gap-3">
          {/* Current org/team scope */}
          <OrgTeamSwitcher />
        </div>

        {/* ── Right ── */}}
        <div className="flex shrink-0 items-center gap-2">
          {/* Clock-in timer (visible when clocked in) — tapping opens the
              clock page, so no separate shortcut button is needed here. */}
          <ClockInHeaderTimer />

          {!onClockPage &&
            (isClockedIn ? (
              /* ── Break / Resume — the one action you actually want mid-shift,
                   so it's a filled pill in both states rather than a quiet
                   outline that disappears into the header chrome. Colours come
                   from the @mieweb/ui variant, not hand-painted classes; the
                   icon carries which state you're in, and the timer beside it
                   goes neutral and stops animating while paused. The label is
                   hidden on the narrowest screens; the icon and aria-label
                   still carry it. ── */
              <Button
                variant="primary"
                size="sm"
                onClick={() => void toggleBreak()}
                isLoading={clockPauseLoading}
                aria-label={isPaused ? 'Resume work' : 'Start break'}
                title={isPaused ? 'Resume work' : 'Start break'}
                className="gap-2 rounded-full font-semibold shadow-sm transition-transform hover:scale-105 active:scale-95"
                leftIcon={<FontAwesomeIcon icon={isPaused ? faPlay : faMugHot} />}
              >
                <span className="hidden sm:inline">{isPaused ? 'Resume' : 'Break'}</span>
              </Button>
            ) : (
              /* ── Clock In — a filled pill so the primary action stands out
                   against the neutral header chrome. ── */
              <Button
                variant="primary"
                size="sm"
                onClick={() => navigate('/app/clock')}
                aria-label="Clock in"
                title="Clock in"
                className="hidden gap-2 rounded-full font-semibold shadow-sm transition-transform hover:scale-[1.03] active:scale-95 sm:inline-flex"
                leftIcon={<FontAwesomeIcon icon={faClock} />}
              >
                Clock In
              </Button>
            ))}

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
