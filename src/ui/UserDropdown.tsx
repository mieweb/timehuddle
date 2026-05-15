/**
 * UserDropdown — Avatar button + floating menu for the authenticated user.
 *
 * Uses @mieweb/ui Dropdown, Avatar, and DropdownItem components.
 */
import {
  faBuilding,
  faCircleUser,
  faGear,
  faRightFromBracket,
  faUsers,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Avatar, Dropdown, DropdownItem, DropdownSeparator, Text } from '@mieweb/ui';
import React, { useCallback, useState } from 'react';

import { useSession } from '../lib/useSession';
import { hasDefaultOrganizationAdminAccess } from '../lib/organizationAccess';
import { useRouter } from './router';

// ─── UserDropdown ─────────────────────────────────────────────────────────────

export const UserDropdown: React.FC = () => {
  const { user, signOut } = useSession();
  const email = user?.email;
  const [open, setOpen] = useState(false);

  const { navigate } = useRouter();

  const handleLogout = useCallback(() => {
    setOpen(false);
    void signOut();
  }, [signOut]);

  const handleProfile = useCallback(() => {
    setOpen(false);
    if (user?.username) {
      navigate(`/${user.username}`);
    } else {
      navigate('/app/settings');
    }
  }, [navigate, user?.username]);

  const displayName = user?.name || email?.split('@')[0] || 'Account';
  const truncated = displayName.length > 22 ? `${displayName.slice(0, 20)}…` : displayName;
  const showOrganizationAdmin = hasDefaultOrganizationAdminAccess(user);

  const handleOrganizationOverview = useCallback(() => {
    setOpen(false);
    navigate('/app/admin/organization');
  }, [navigate]);

  const handleOrganizationMembers = useCallback(() => {
    setOpen(false);
    navigate('/app/admin/users');
  }, [navigate]);

  const handleOrganizationSettings = useCallback(() => {
    setOpen(false);
    navigate('/app/admin/organization/settings');
  }, [navigate]);

  return (
    <Dropdown
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button
          type="button"
          className="flex items-center rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          aria-label="Account menu"
        >
          <Avatar name={displayName} size="sm" />
        </button>
      }
      placement="bottom-end"
      width={224}
    >
      {/* User info */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        <Avatar name={displayName} size="md" />
        <div className="min-w-0">
          <Text size="sm" weight="medium" truncate>
            {truncated}
          </Text>
          <Text variant="muted" size="xs" className="mt-0.5">
            Authenticated
          </Text>
        </div>
      </div>

      <DropdownSeparator />

      <DropdownItem icon={<FontAwesomeIcon icon={faCircleUser} />} onClick={handleProfile}>
        Profile
      </DropdownItem>

      {showOrganizationAdmin && (
        <>
          <DropdownItem
            icon={<FontAwesomeIcon icon={faBuilding} />}
            onClick={handleOrganizationOverview}
          >
            Organization
          </DropdownItem>
          <DropdownItem icon={<FontAwesomeIcon icon={faUsers} />} onClick={handleOrganizationMembers}>
            Members
          </DropdownItem>
          <DropdownItem
            icon={<FontAwesomeIcon icon={faGear} />}
            onClick={handleOrganizationSettings}
          >
            Organization Settings
          </DropdownItem>
        </>
      )}

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
