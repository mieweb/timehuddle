/**
 * UserDropdown — Avatar button + floating menu for the authenticated user.
 *
 * Uses @mieweb/ui Dropdown, Avatar, and DropdownItem components.
 */
import { faChevronDown, faCircleUser, faRightFromBracket } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Avatar,
  Dropdown,
  DropdownItem,
  DropdownSeparator,
  Text,
} from '@mieweb/ui';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import React, { useCallback } from 'react';

import { useRouter } from './router';

// ─── UserDropdown ─────────────────────────────────────────────────────────────

export const UserDropdown: React.FC = () => {
  const user = useTracker(() => Meteor.user());
  const email: string | undefined =
    user?.emails?.[0]?.address ?? (user?.profile as { email?: string } | undefined)?.email;

  const { navigate } = useRouter();

  const handleLogout = useCallback(() => {
    Meteor.logout();
  }, []);

  const handleProfile = useCallback(() => {
    const uid = Meteor.userId();
    if (uid) navigate(`/app/profile/${uid}`);
  }, [navigate]);

  const displayName = email ?? 'Account';
  const truncated = displayName.length > 22 ? `${displayName.slice(0, 20)}…` : displayName;

  return (
    <Dropdown
      trigger={
        <button
          type="button"
          className="flex h-9 items-center gap-2 rounded-lg border border-transparent px-2 text-sm text-neutral-700 transition-colors hover:border-neutral-200 hover:bg-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:text-neutral-300 dark:hover:border-neutral-700 dark:hover:bg-neutral-800"
        >
          <Avatar name={displayName} size="sm" />
          <span className="hidden max-w-[140px] truncate sm:block">{truncated}</span>
          <FontAwesomeIcon
            icon={faChevronDown}
            className="text-[10px] text-neutral-400"
          />
        </button>
      }
      placement="bottom-end"
      width={224}
    >
      {/* User info */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        <Avatar name={displayName} size="md" />
        <div className="min-w-0">
          <Text size="sm" weight="medium" truncate>{truncated}</Text>
          <Text variant="muted" size="xs" className="mt-0.5">Authenticated</Text>
        </div>
      </div>

      <DropdownSeparator />

      <DropdownItem
        icon={<FontAwesomeIcon icon={faCircleUser} />}
        onClick={handleProfile}
      >
        Profile
      </DropdownItem>

      <DropdownSeparator />

      <DropdownItem
        icon={<FontAwesomeIcon icon={faRightFromBracket} />}
        variant="danger"
        onClick={handleLogout}
      >
        Sign out
      </DropdownItem>
    </Dropdown>
  );
};
