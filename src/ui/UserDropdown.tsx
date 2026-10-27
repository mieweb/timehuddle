/**
 * UserDropdown — Avatar button + floating menu for the authenticated user.
 *
 * Uses @mieweb/ui Dropdown, Avatar, and DropdownItem components. The Admin,
 * Developers and Help groups come from ./accountMenu, shared with the mobile
 * More sheet, and show at every width.
 */
import {
  Badge,
  CircleUserIcon,
  Dropdown,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  LogOutIcon,
  SettingsIcon,
  SparkleIcon,
  Text,
} from '@mieweb/ui';
import React, { useCallback, useMemo, useState } from 'react';

import { releaseNotes, unseenReleaseNotes } from '../features/release-notes/notes';
import { useSession } from '../lib/useSession';
import { useAccountMenuSections } from './accountMenu';
import { useRouter } from './router';
import { UserAvatar } from './UserAvatar';

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

  const unseenReleaseCount = useMemo(
    () => unseenReleaseNotes(releaseNotes, user?.releaseNotesSeenVersion, user?.createdAt).length,
    [user?.createdAt, user?.releaseNotesSeenVersion],
  );

  const handleReleaseNotes = useCallback(() => {
    setOpen(false);
    navigate('/app/release-notes');
  }, [navigate]);

  const handleProfile = useCallback(() => {
    setOpen(false);
    if (user?.username) {
      navigate(`/app/profile/${user.username}`);
    } else {
      navigate('/app/settings');
    }
  }, [navigate, user?.username]);

  const displayName = user?.name || email?.split('@')[0] || 'Account';
  const truncated = displayName.length > 22 ? `${displayName.slice(0, 20)}…` : displayName;
  const sections = useAccountMenuSections();

  const handleSettings = useCallback(() => {
    setOpen(false);
    navigate('/app/settings');
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

        <DropdownItem icon={<CircleUserIcon className="h-4 w-4" />} onClick={handleProfile}>
          <span className="font-normal">Profile</span>
        </DropdownItem>

        <DropdownItem icon={<SettingsIcon className="h-4 w-4" />} onClick={handleSettings}>
          <span className="font-normal">Settings</span>
        </DropdownItem>

        {sections.map((section) => (
          <React.Fragment key={section.id}>
            <DropdownSeparator />
            <DropdownLabel>{section.label}</DropdownLabel>
            {section.items.map((item) => (
              <DropdownItem
                key={item.label}
                icon={<item.icon className="h-4 w-4" />}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                <span className="font-normal">{item.label}</span>
              </DropdownItem>
            ))}
          </React.Fragment>
        ))}

        <DropdownItem icon={<SparkleIcon className="h-4 w-4" />} onClick={handleReleaseNotes}>
          <span className="font-normal">What&rsquo;s New</span>
          {unseenReleaseCount > 0 && (
            <Badge
              variant="success"
              size="sm"
              className="ms-2"
              aria-label={`${unseenReleaseCount} unread ${unseenReleaseCount === 1 ? 'release note' : 'release notes'}`}
            >
              {unseenReleaseCount}
            </Badge>
          )}
        </DropdownItem>

        <DropdownSeparator />

        <DropdownItem
          icon={<LogOutIcon className="h-4 w-4" />}
          variant="danger"
          onClick={handleLogout}
        >
          <span className="font-normal">Sign out</span>
        </DropdownItem>
      </Dropdown>
    </>
  );
};
