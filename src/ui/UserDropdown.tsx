/**
 * UserDropdown — Avatar button + floating menu for the authenticated user.
 *
 * Uses @mieweb/ui Dropdown, Avatar, and DropdownItem components.
 */
import {
  faCheck,
  faCircleUser,
  faRightFromBracket,
  faUsers,
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
  const { teams, selectedTeam, setSelectedTeamId, teamsReady } = useTeam();
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

  const handleSelectTeam = useCallback(
    (teamId: string) => {
      setSelectedTeamId(teamId);
      setOpen(false);
    },
    [setSelectedTeamId],
  );

  const displayName = user?.name || email?.split('@')[0] || 'Account';
  const truncated = displayName.length > 22 ? `${displayName.slice(0, 20)}…` : displayName;
  const showOrganizationAdmin = hasDefaultOrganizationAdminAccess(user);

  const handleOrganizationMembers = useCallback(() => {
    setOpen(false);
    navigate('/org/members');
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
          <UserAvatar name={displayName} size="sm" src={user?.image} />
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
        Profile
      </DropdownItem>

      {teamsReady && teams.length > 0 && (
        <>
          <DropdownSeparator />
          {teams.map((team) => (
            <DropdownItem key={team.id} onClick={() => handleSelectTeam(team.id)}>
              <span className="flex items-center gap-2">
                <FontAwesomeIcon
                  icon={faCheck}
                  className={`text-xs text-primary-600 transition-opacity ${
                    team.id === selectedTeam?.id ? 'opacity-100' : 'opacity-0'
                  }`}
                />
                <span>{team.name}</span>
              </span>
            </DropdownItem>
          ))}
        </>
      )}

      {showOrganizationAdmin && (
        <>
          <DropdownSeparator />
          <DropdownItem
            icon={<FontAwesomeIcon icon={faUsers} />}
            onClick={handleOrganizationMembers}
          >
            Members
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
