/**
 * TopNav — the app's destinations as a bar under the header (md+).
 *
 * On a phone it is hidden; the bottom nav and its More sheet carry the same
 * destinations. Groups are split by a divider; on a narrow window the bar
 * scrolls sideways rather than wrapping. Media (Unsent videos) shows only
 * under Pulse's visibility rule, with its attention count as a badge.
 */
import {
  Badge,
  BriefcaseIcon,
  Button,
  ClipboardListIcon,
  ClockIcon,
  cn,
  HomeIcon,
  MessageIcon,
  PersonIcon,
  SettingsIcon,
  UsersIcon,
  type LucideIcon,
} from '@mieweb/ui';
import { Film } from 'lucide-react';
import React from 'react';

import { MEDIA_TEXT } from '../features/media/mediaStrings';
import { MEDIA_PATH, useMediaNav } from '../features/media/mediaVisibility';
import { isActivePath, useRouter } from './router';

interface NavItem {
  icon: LucideIcon;
  label: string;
  href: string;
  /** A count that needs the person, as a badge. */
  badge?: number;
}

const MEDIA_ITEM: NavItem = { icon: Film, label: MEDIA_TEXT.title, href: MEDIA_PATH };

const NAV: NavItem[][] = [
  [
    { icon: HomeIcon, label: 'Dashboard', href: '/app/dashboard' },
    { icon: ClockIcon, label: 'Clock', href: '/app/clock' },
    { icon: MessageIcon, label: 'Huddle', href: '/app/huddle' },
    { icon: ClipboardListIcon, label: 'Tickets', href: '/app/tickets' },
  ],
  [
    { icon: UsersIcon, label: 'Teams', href: '/app/teams' },
    { icon: PersonIcon, label: 'People', href: '/app/organization' },
    { icon: BriefcaseIcon, label: 'Enterprise', href: '/app/enterprise' },
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
      aria-label={item.badge ? MEDIA_TEXT.navLabel(item.badge) : undefined}
      leftIcon={<item.icon className="h-4 w-4" />}
      className={cn(
        'top-nav-link',
        active && 'bg-primary-50 text-primary-700 dark:bg-primary-950/60 dark:text-primary-400',
      )}
    >
      {item.label}
      {item.badge ? (
        <Badge size="sm" variant="danger" className="top-nav-badge ms-1" aria-hidden>
          {MEDIA_TEXT.navBadge(item.badge)}
        </Badge>
      ) : null}
    </Button>
  );
};

export const TopNav: React.FC = () => {
  const { pathname } = useRouter();
  const media = useMediaNav();
  // Media sits with the daily destinations, after Tickets, while it shows.
  const nav = media.visible
    ? [[...NAV[0], { ...MEDIA_ITEM, badge: media.attention }], ...NAV.slice(1)]
    : NAV;
  return (
    <nav
      aria-label="Main navigation"
      className="top-nav hidden shrink-0 items-center gap-1 overflow-x-auto border-b border-neutral-200 bg-white px-4 py-1.5 md:flex dark:border-neutral-800 dark:bg-neutral-900"
    >
      {nav.map((group, gi) => (
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
