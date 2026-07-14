/**
 * UserDropdown — Avatar button + floating menu for the authenticated user.
 *
 * Uses @mieweb/ui Dropdown, Avatar, and DropdownItem components.
 */
import {
  faBuilding,
  faCircleUser,
  faRightFromBracket,
  faUsers,
  faWrench,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Dropdown, DropdownItem, DropdownSeparator, Text } from '@mieweb/ui';
import React, { useCallback, useState } from 'react';

import { useTeam } from '../lib/TeamContext';
import { useSession } from '../lib/useSession';
import { hasDefaultOrganizationAdminAccess } from '../lib/organizationAccess';
import { useRouter } from './router';
import { UserAvatar } from './UserAvatar';

// ─── UserDropdown ─────────────────────────────────────────────────────────────

export const UserDropdown: React.FC = () => {
  const { user, signOut } = useSession();
  const { enterprises } = useTeam();
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

  const handleOrganizationMembers = useCallback(() => {
    setOpen(false);
    navigate('/app/org/members');
  }, [navigate]);

  const handleEnterprisePage = useCallback(() => {
    setOpen(false);
    navigate('/app/enterprise');
  }, [navigate]);

  const handleSeeder = useCallback(() => {
    setOpen(false);
    navigate('/app/seeder');
  }, [navigate]);

  return (
    <>
      <Dropdown
        open={open}
        onOpenChange={setOpen}
        trigger={
          <button
            type="button"
            className="flex items-center gap-2 rounded-full px-1 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            aria-label="Account menu"
          >
            <UserAvatar name={displayName} size="sm" src={user?.image} />
            <Text size="sm" weight="medium" className="hidden max-w-32 truncate md:block">
              {truncated}
            </Text>
          </button>
        }
        placement="bottom-end"
        width={224}
      >
        {/* User info */}
        <div className="flex items-center gap-3 px-3 py-2.5">
          <UserAvatar name={displayName} size="md" src={user?.image} />
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
          <span className="font-normal">Profile</span>
        </DropdownItem>

        {(showOrganizationAdmin || enterprises.length > 0) && (
          <>
            <DropdownSeparator />
            <div className="px-3 py-1">
              <Text
                variant="muted"
                size="xs"
                className="text-left font-semibold uppercase tracking-wide"
              >
                Admin
              </Text>
            </div>
          </>
        )}

        {enterprises.length > 0 && (
          <DropdownItem icon={<FontAwesomeIcon icon={faBuilding} />} onClick={handleEnterprisePage}>
            <span className="font-normal">Enterprise</span>
          </DropdownItem>
        )}

        {(showOrganizationAdmin || enterprises.length > 0) && (
          <DropdownItem
            icon={<FontAwesomeIcon icon={faUsers} />}
            onClick={handleOrganizationMembers}
          >
            <span className="font-normal">Members</span>
          </DropdownItem>
        )}

        {import.meta.env.MODE !== 'production' && (
          <>
            <DropdownSeparator />
            <div className="px-3 py-1">
              <Text
                variant="muted"
                size="xs"
                className="text-left font-semibold uppercase tracking-wide"
              >
                Developers
              </Text>
            </div>
            <DropdownItem icon={<FontAwesomeIcon icon={faWrench} />} onClick={handleSeeder}>
              <span className="font-normal">Seeder</span>
            </DropdownItem>
          </>
        )}

        <DropdownSeparator />

        <DropdownItem
          icon={<FontAwesomeIcon icon={faRightFromBracket} />}
          variant="danger"
          onClick={handleLogout}
        >
          <span className="font-normal">Sign out</span>
        </DropdownItem>
      </Dropdown>
    </>
  );
};
