/**
 * BottomNav — Mobile-only bottom navigation bar.
 *
 * Visible only on small screens (md:hidden).
 * Five tabs: Dashboard, Huddle, Clock In/Out (center FAB), Tickets, More.
 * "More" opens a sheet with the remaining sidebar destinations (Teams,
 * Organization, Work, Activity Log, Profile, Settings) so every sidebar link
 * stays reachable on mobile without a hamburger drawer. Notifications is not
 * among them — the header's bell icon is present at every width.
 * Active tab indicator is an animated bubble that glides between positions.
 * FAB uses CSS brand tokens so it follows brand/theme changes automatically.
 * The FAB navigates to the clock page (rather than toggling directly) so the
 * plan-first gates and their inline composer are always visible.
 */
import {
  Button,
  BuildingIcon,
  ChevronLeftIcon,
  CircleUserIcon,
  ClipboardListIcon,
  ClockIcon,
  HistoryIcon,
  HomeIcon,
  MessageIcon,
  MoreHorizontalIcon,
  SettingsIcon,
  StopIcon,
  TimerIcon,
  UsersIcon,
  XIcon,
  type LucideIcon,
} from '@mieweb/ui';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import React, { useState } from 'react';

import { useClockToggle } from '../lib/useClockToggle';
import { useSession } from '../lib/useSession';
import { useAccountMenuSections, type AccountMenuSectionId } from './accountMenu';
import { useRouter } from './router';

interface NavTab {
  icon: LucideIcon;
  label: string;
  href: string;
  isFab?: boolean;
  isMore?: boolean;
}

const TABS: NavTab[] = [
  { icon: HomeIcon, label: 'Home', href: '/app/dashboard' },
  { icon: MessageIcon, label: 'Huddle', href: '/app/huddle' },
  { icon: ClockIcon, label: 'Clock In', href: '/app/clock', isFab: true },
  { icon: ClipboardListIcon, label: 'Tickets', href: '/app/tickets' },
  { icon: MoreHorizontalIcon, label: 'More', href: '', isMore: true },
];

interface MoreItem {
  icon: LucideIcon;
  label: string;
  href: string;
}

const MORE_ITEMS: MoreItem[] = [
  { icon: UsersIcon, label: 'Teams', href: '/app/teams' },
  { icon: BuildingIcon, label: 'Organization', href: '/app/organization' },
  { icon: CircleUserIcon, label: 'Profile', href: '/app/settings' },
  { icon: TimerIcon, label: 'Work', href: '/app/work' },
  { icon: HistoryIcon, label: 'Activity Log', href: '/app/activity' },
  { icon: SettingsIcon, label: 'Settings', href: '/app/settings' },
];

/** Sub-sections of the More sheet — the account menu's Admin/Developers/Help
 *  groups (./accountMenu), which drill down into a row list instead of
 *  navigating away immediately. */
type MoreSection = 'root' | AccountMenuSectionId;

const MORE_TILE_CLASS =
  'flex flex-col items-center gap-1.5 rounded-xl bg-neutral-50 py-4 text-neutral-700 transition-colors hover:bg-neutral-100 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700';

export const BottomNav: React.FC = () => {
  const { pathname, navigate } = useRouter();
  const { isClockedIn, planGate } = useClockToggle();
  const { user } = useSession();
  const accountSections = useAccountMenuSections();
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreSection, setMoreSection] = useState<MoreSection>('root');
  const moreButtonRef = React.useRef<HTMLButtonElement>(null);
  const moreDialogRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!moreOpen) return undefined;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move focus into the first interactive element in the sheet
    const dialog = moreDialogRef.current;
    const firstFocusable = dialog?.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled])',
    );
    firstFocusable?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMoreOpen(false);
        setMoreSection('root');
        moreButtonRef.current?.focus();
        return;
      }
      if (e.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
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
    moreButtonRef.current?.focus();
  };
  const goToMoreItem = (href: string) => {
    closeMore();
    navigate(href);
  };
  const goToProfile = () => {
    closeMore();
    navigate(user?.username ? `/app/profile/${user.username}` : '/app/settings');
  };

  const activeSection = accountSections.find((section) => section.id === moreSection);

  // Plan-first gate: the FAB always navigates to the clock page (where the
  // inline composer lives) in full color — it's a link, not a disabled
  // control, so it never dims even when today's plan/wrap-up is still needed.
  const planBlocked = planGate.planMissing || planGate.wrapUpMissing;

  return (
    <MotionConfig transition={{ type: 'spring', damping: 26, stiffness: 300 }}>
      <nav
        className="bottom-nav fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-neutral-200 bg-white px-2 dark:border-neutral-800 dark:bg-neutral-900 md:hidden"
        aria-label="Bottom navigation"
      >
        {/* The FAB and tab buttons stay raw: `Button` wraps its children in a
            single `truncate` span and its base is a horizontal `inline-flex`,
            neither of which can express an icon stacked over a label. */}
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
                className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-full shadow-lg transition-transform active:scale-95 disabled:opacity-60"
                style={{
                  background: isClockedIn
                    ? 'linear-gradient(135deg, #f87171, #dc2626)'
                    : 'linear-gradient(135deg, var(--color-primary-400, #60a5fa), var(--color-primary-600, #2563eb))',
                  boxShadow: isClockedIn
                    ? '0 4px 18px 0 rgb(220 38 38 / 45%)'
                    : '0 4px 18px 0 color-mix(in srgb, var(--color-primary, #3b82f6) 45%, transparent)',
                }}
              >
                {isClockedIn ? (
                  <StopIcon className="h-6 w-6 text-white" />
                ) : (
                  <tab.icon className="h-6 w-6 text-white" />
                )}
                <span className="mt-0.5 text-[9px] font-medium text-white/90">
                  {isClockedIn ? 'Clock Out' : 'Clock In'}
                </span>
              </button>
            );
          }

          return (
            <button
              key={tab.href || tab.label}
              ref={tab.isMore ? moreButtonRef : null}
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
              <tab.icon className="relative h-5 w-5" />
              <span className="relative text-[10px] font-medium">{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Deliberately not the @mieweb/ui `Sheet`. Sheet renders nothing until
          open and unmounts on close, and carries no enter/exit animation of its
          own — its only animation hook, the `animate-in`/`slide-in-from-*`
          utilities the library's own Modal references, needs
          `tailwindcss-animate`, which this project does not install. Swapping
          would turn this spring slide-up into an abrupt pop on the primary
          mobile surface. The focus trap, scroll lock, escape handling and focus
          restore below are the behaviour Sheet would otherwise provide. */}
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
              ref={moreDialogRef}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="absolute inset-x-0 bottom-0 flex max-h-[88vh] flex-col rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-xl dark:bg-neutral-900"
            >
              <div className="flex shrink-0 items-center gap-2 border-b border-neutral-100 px-5 py-4 dark:border-neutral-800">
                {moreSection !== 'root' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setMoreSection('root')}
                    aria-label="Back"
                    className="rounded-full text-neutral-400"
                  >
                    <ChevronLeftIcon className="h-4 w-4" />
                  </Button>
                )}
                <h2 className="flex-1 font-semibold text-neutral-900 dark:text-neutral-100">
                  {activeSection?.label ?? 'More'}
                </h2>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={closeMore}
                  aria-label="Close"
                  className="rounded-full text-neutral-400"
                >
                  <XIcon className="h-4 w-4" />
                </Button>
              </div>
              <div className="overflow-y-auto px-5 py-4">
                {!activeSection ? (
                  <div className="grid grid-cols-3 gap-3">
                    {MORE_ITEMS.map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        onClick={
                          item.label === 'Profile' ? goToProfile : () => goToMoreItem(item.href)
                        }
                        className={MORE_TILE_CLASS}
                      >
                        <item.icon className="h-6 w-6" />
                        <span className="text-xs font-medium">{item.label}</span>
                      </button>
                    ))}
                    {accountSections.map((section) => (
                      <button
                        key={section.id}
                        type="button"
                        onClick={() => setMoreSection(section.id)}
                        className={MORE_TILE_CLASS}
                      >
                        <section.icon className="h-6 w-6" />
                        <span className="text-xs font-medium">{section.label}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {activeSection.items.map((item) => (
                      <Button
                        key={item.label}
                        variant="ghost"
                        fullWidth
                        onClick={() => {
                          closeMore();
                          item.onSelect();
                        }}
                        leftIcon={<item.icon className="h-5 w-5" />}
                        className="justify-start gap-3 px-3 py-3 text-neutral-700 dark:text-neutral-200"
                      >
                        {item.label}
                      </Button>
                    ))}
                  </div>
                )}
                <p className="mt-4 text-center font-mono text-[10px] text-neutral-400 dark:text-neutral-600">
                  v{import.meta.env.VITE_APP_VERSION || '1.0.0'}
                </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
};
