/**
 * CommandPalette — Global command menu triggered by Cmd+K (Mac) or Ctrl+K (Windows/Linux).
 *
 * Provides quick navigation to any page in the app. Uses cmdk for the command
 * menu behavior and integrates with the app's custom router.
 */
import {
  faBell,
  faClock,
  faClockRotateLeft,
  faEnvelope,
  faGauge,
  faGear,
  faListCheck,
  faStopwatch,
  faTable,
  faUsers,
} from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Command } from 'cmdk';
import React, { useCallback, useEffect, useState } from 'react';

import { useRouter } from './router';

interface NavItem {
  icon: IconDefinition;
  label: string;
  href: string;
  keywords?: string[];
}

interface NavSection {
  heading: string;
  items: NavItem[];
}

const NAV_ITEMS: NavSection[] = [
  {
    heading: 'Workspace',
    items: [
      { icon: faGauge, label: 'Dashboard', href: '/app/dashboard', keywords: ['home', 'overview'] },
      { icon: faStopwatch, label: 'Work', href: '/app/work', keywords: ['timer', 'tracking'] },
      { icon: faListCheck, label: 'Tickets', href: '/app/tickets', keywords: ['tasks', 'issues'] },
      { icon: faTable, label: 'Timesheet', href: '/app/timesheet', keywords: ['hours', 'log'] },
    ],
  },
  {
    heading: 'Manage',
    items: [
      { icon: faUsers, label: 'Teams', href: '/app/teams', keywords: ['members', 'groups'] },
      { icon: faEnvelope, label: 'Messages', href: '/app/messages', keywords: ['chat', 'inbox'] },
      {
        icon: faBell,
        label: 'Notifications',
        href: '/app/notifications',
        keywords: ['alerts', 'updates'],
      },
      {
        icon: faClockRotateLeft,
        label: 'Activity Log',
        href: '/app/activity',
        keywords: ['history', 'audit'],
      },
    ],
  },
  {
    heading: 'System',
    items: [
      { icon: faClock, label: 'Clock', href: '/app/clock', keywords: ['punch', 'in', 'out'] },
      {
        icon: faGear,
        label: 'Settings',
        href: '/app/settings',
        keywords: ['preferences', 'config'],
      },
    ],
  },
];

export const CommandPalette: React.FC = () => {
  const [open, setOpen] = useState(false);
  const { navigate } = useRouter();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSelect = useCallback(
    (href: string) => {
      navigate(href);
      setOpen(false);
    },
    [navigate],
  );

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command Menu"
      className="fixed inset-0 z-50"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20"
        onClick={() => setOpen(false)}
        aria-hidden
      />

      {/* Dialog container */}
      <div className="fixed inset-0 flex items-start justify-center pt-[20vh]">
        <div className="w-full max-w-lg overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-[0_25px_50px_-12px_rgba(0,0,0,0.4)] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.7)]">
          <Command.Input
            placeholder="Type a command or search..."
            className="w-full border-b border-neutral-200 bg-transparent px-4 py-3 text-base text-neutral-900 outline-none placeholder:text-neutral-500 dark:border-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-400"
          />

          <Command.List className="max-h-80 overflow-y-auto p-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-neutral-300 dark:[&::-webkit-scrollbar-thumb]:bg-neutral-700 [&::-webkit-scrollbar-thumb:hover]:bg-neutral-400 dark:[&::-webkit-scrollbar-thumb:hover]:bg-neutral-600">
            <Command.Empty className="px-4 py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
              No results found.
            </Command.Empty>

            {NAV_ITEMS.map((section) => (
              <Command.Group
                key={section.heading}
                heading={section.heading}
                className="**:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-neutral-500 **:[[cmdk-group-heading]]:dark:text-neutral-400"
              >
                {section.items.map((item) => (
                  <Command.Item
                    key={item.href}
                    value={`${item.label} ${item.keywords?.join(' ') ?? ''}`}
                    onSelect={() => handleSelect(item.href)}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-neutral-700 outline-none transition-colors data-[selected=true]:bg-neutral-100 dark:text-neutral-300 dark:data-[selected=true]:bg-neutral-800"
                  >
                    <FontAwesomeIcon
                      icon={item.icon}
                      className="h-4 w-4 text-neutral-500 dark:text-neutral-400"
                    />
                    <span>{item.label}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
          </Command.List>

          <div className="border-t border-neutral-200 px-4 py-2 dark:border-neutral-800">
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              <kbd className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] dark:bg-neutral-800">
                ↵
              </kbd>{' '}
              to select{' '}
              <kbd className="ml-2 rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] dark:bg-neutral-800">
                esc
              </kbd>{' '}
              to close
            </p>
          </div>
        </div>
      </div>
    </Command.Dialog>
  );
};
