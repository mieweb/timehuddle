/**
 * TopNav — the app's destinations as a bar under the header (md+).
 *
 * On a phone it is hidden; the bottom nav and its More sheet carry the same
 * destinations. Groups are split by a divider; on a narrow window the bar
 * scrolls sideways rather than wrapping.
 */
import {
  BuildingIcon,
  Button,
  ClipboardListIcon,
  ClockIcon,
  cn,
  HistoryIcon,
  HomeIcon,
  MessageIcon,
  SettingsIcon,
  TimerIcon,
  UsersIcon,
  type LucideIcon,
} from '@mieweb/ui';
import React from 'react';

import { isActivePath, useRouter } from './router';

interface NavItem {
  icon: LucideIcon;
  label: string;
  href: string;
}

const NAV: NavItem[][] = [
  [
    { icon: HomeIcon, label: 'Dashboard', href: '/app/dashboard' },
    { icon: MessageIcon, label: 'Huddle', href: '/app/huddle' },
    { icon: ClockIcon, label: 'Clock', href: '/app/clock' },
    { icon: ClipboardListIcon, label: 'Tickets', href: '/app/tickets' },
    { icon: TimerIcon, label: 'Work', href: '/app/work' },
  ],
  [
    { icon: UsersIcon, label: 'Teams', href: '/app/teams' },
    { icon: BuildingIcon, label: 'Organization', href: '/app/organization' },
    { icon: HistoryIcon, label: 'Activity Log', href: '/app/activity' },
  ],
  [{ icon: SettingsIcon, label: 'Settings', href: '/app/settings' }],
];

const NavLink: React.FC<{ item: NavItem; active: boolean }> = ({ item, active }) => {
  const { navigate } = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => navigate(item.href)}
      aria-current={active ? 'page' : undefined}
      leftIcon={<item.icon className="h-4 w-4" />}
      className={cn(
        'top-nav-link',
        active && 'bg-primary-50 text-primary-700 dark:bg-primary-950/60 dark:text-primary-400',
      )}
    >
      {item.label}
    </Button>
  );
};

export const TopNav: React.FC = () => {
  const { pathname } = useRouter();
  return (
    <nav
      aria-label="Main navigation"
      className="top-nav hidden shrink-0 items-center gap-1 overflow-x-auto border-b border-neutral-200 bg-white px-4 py-1.5 md:flex dark:border-neutral-800 dark:bg-neutral-900"
    >
      {NAV.map((group, gi) => (
        <ul key={gi} className="top-nav-group flex items-center gap-1">
          {gi > 0 && (
            <li aria-hidden="true" className="mx-1 h-5 w-px bg-neutral-200 dark:bg-neutral-800" />
          )}
          {group.map((item) => (
            <li key={item.label} className="shrink-0">
              <NavLink item={item} active={isActivePath(pathname, item.href)} />
            </li>
          ))}
        </ul>
      ))}
    </nav>
  );
};
