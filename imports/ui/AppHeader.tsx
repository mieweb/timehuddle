/**
 * AppHeader — Sticky top bar.
 *
 * Left  : hamburger (mobile), current page title
 * Right : ThemeToggle, UserDropdown
 */
import { faBars } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Text } from '@mieweb/ui';
import React from 'react';

import { useSidebar } from './AppLayout';
import { ThemeToggle } from './ThemeToggle';
import { UserDropdown } from './UserDropdown';

interface AppHeaderProps {
  title: string;
}

export const AppHeader: React.FC<AppHeaderProps> = ({ title }) => {
  const { openMobile } = useSidebar();

  return (
    <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-neutral-200 bg-white/80 px-4 backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-900/80">
      {/* ── Left ── */}
      <div className="flex items-center gap-3">
        {/* Mobile hamburger */}
        <Button
          variant="ghost"
          size="icon"
          onClick={openMobile}
          aria-label="Open navigation"
          className="md:hidden"
        >
          <FontAwesomeIcon icon={faBars} />
        </Button>

        {/* Page title */}
        <Text as="h1" size="base" weight="semibold" className="tracking-tight">
          {title}
        </Text>
      </div>

      {/* ── Right ── */}
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <UserDropdown />
      </div>
    </header>
  );
};
