/**
 * ProfilePage — Read-only profile view (used within the authenticated app shell).
 *
 * • Teammates can view each other's profiles (enforced server-side).
 * • 403 → graceful "profile unavailable" fallback.
 * • Shared team context shown when viewing a teammate's profile.
 * • Owner sees a link to /app/settings to edit their profile.
 * • All editing is handled in SettingsPage — no inline edit form here.
 */
import { faCrown, faGear, faGlobe, faUser, faUsers } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Avatar, Badge, Button, Card, Spinner, Text } from '@mieweb/ui';
import React, { useEffect, useState } from 'react';

import { ApiError, userApi, type PublicUser } from '../../lib/api';
import { useSession } from '../../lib/useSession';
import { AppPage } from '../../ui/AppPage';
import { useRouter } from '../../ui/router';

type ProfilePageProps = { userId: string; username?: never } | { username: string; userId?: never };

export const ProfilePage: React.FC<ProfilePageProps> = ({ userId, username }) => {
  const { user: sessionUser } = useSession();
  const { navigate } = useRouter();
  const isOwn = userId ? sessionUser?.id === userId : sessionUser?.username === username;

  const [profile, setProfile] = useState<PublicUser | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isForbidden, setIsForbidden] = useState(false);
  const [isNotFound, setIsNotFound] = useState(false);

  useEffect(() => {
    setIsReady(false);
    setIsForbidden(false);
    setIsNotFound(false);
    const fetch = userId ? userApi.getUser(userId) : userApi.getUserByUsername(username!);
    fetch
      .then((p) => setProfile(p))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) {
          setIsForbidden(true);
        } else if (err instanceof ApiError && err.status === 404) {
          setIsNotFound(true);
        }
        setProfile(null);
      })
      .finally(() => setIsReady(true));
  }, [userId, username]);

  if (!isReady) {
    return (
      <div className="flex flex-1 items-center justify-center p-10">
        <Spinner size="lg" label="Loading…" />
      </div>
    );
  }

  // 404 — user does not exist
  if (isNotFound) {
    return (
      <div className="w-full space-y-6 p-6">
        <Card padding="lg" className="flex flex-col items-center gap-4 text-center">
          <Avatar name="?" size="xl" />
          <Text as="h1" size="xl" weight="bold">
            User Not Found
          </Text>
          <Text variant="muted" size="sm">
            This profile does not exist or the username may have changed.
          </Text>
        </Card>
      </div>
    );
  }

  // 403 — not a teammate
  if (isForbidden) {
    return (
      <div className="w-full space-y-6 p-6">
        <Card padding="lg" className="flex flex-col items-center gap-4 text-center">
          <Avatar name="?" size="xl" />
          <Text as="h1" size="xl" weight="bold">
            Profile Unavailable
          </Text>
          <Text variant="muted" size="sm">
            You can only view profiles of people who share a team with you.
          </Text>
        </Card>
      </div>
    );
  }

  const nameText = profile?.name || sessionUser?.email?.split('@')[0] || 'Unknown user';

  return (
    <AppPage>
      {/* FUTURE: Show notices if any need to be shown */}
      {/* <ProfileNotices notices={[{ type: 'coming-soon' }]} /> */}

      {/* Profile header card */}
      <Card padding="lg" className="flex items-start gap-5">
        <Avatar name={nameText} size="xl" />

        <div className="min-w-0 flex-1">
          <Text as="h1" size="xl" weight="bold">
            {nameText}
          </Text>

          {profile?.username && (
            <Text variant="muted" size="sm" className="mt-0.5">
              @{profile.username}
            </Text>
          )}

          {isOwn && sessionUser?.email && (
            <Text variant="muted" size="sm" className="mt-0.5">
              {sessionUser.email}
            </Text>
          )}

          {profile?.bio && (
            <Text size="sm" className="mt-2">
              {profile.bio}
            </Text>
          )}

          {profile?.website && (
            <a
              href={profile.website}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-blue-600 hover:underline dark:text-blue-400"
            >
              <FontAwesomeIcon icon={faGlobe} className="shrink-0" />
              {profile.website.replace(/^https?:\/\//, '')}
            </a>
          )}

          {isOwn && !profile?.name && !profile?.bio && (
            <Text variant="muted" size="xs" className="mt-2">
              Your profile is empty. Go to Settings to add a display name and bio.
            </Text>
          )}
        </div>

        {isOwn && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/app/settings')}
            aria-label="Edit profile in Settings"
            leftIcon={<FontAwesomeIcon icon={faGear} className="text-xs" />}
          >
            Edit
          </Button>
        )}
      </Card>

      {profile && (
        <Card padding="lg">
          <div className="mb-4 flex items-center gap-2">
            <FontAwesomeIcon icon={faUser} className="text-neutral-500" aria-hidden="true" />
            <Text size="sm" weight="semibold">
              Working Context
            </Text>
          </div>

          <div className="grid gap-5 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
            <div>
              <Text variant="muted" size="xs" className="mb-1 block uppercase tracking-wide">
                Reports To
              </Text>
              {profile.reportsTo ? (
                <>
                  <Text size="sm" weight="medium">
                    {profile.reportsTo.name}
                  </Text>
                  {profile.reportsTo.username && (
                    <Text variant="muted" size="xs" className="mt-0.5">
                      @{profile.reportsTo.username}
                    </Text>
                  )}
                </>
              ) : (
                <Text variant="muted" size="sm">
                  Not set
                </Text>
              )}
            </div>

            <div>
              <Text variant="muted" size="xs" className="mb-2 block uppercase tracking-wide">
                Team Memberships
              </Text>
              {profile.teamMemberships.length > 0 ? (
                <ul className="space-y-2">
                  {profile.teamMemberships.map((team) => (
                    <li key={team.id} className="flex items-center gap-2">
                      <Text size="sm">{team.name}</Text>
                      <Badge variant={team.role === 'admin' ? 'warning' : 'secondary'} size="sm">
                        {team.role === 'admin' ? 'Admin' : 'Member'}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <Text variant="muted" size="sm">
                  No team memberships yet.
                </Text>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Shared teams — shown when viewing a teammate's profile */}
      {!isOwn && profile?.sharedTeams && profile.sharedTeams.length > 0 && (
        <Card padding="lg">
          <div className="flex items-center gap-2 mb-3">
            <FontAwesomeIcon icon={faUsers} className="text-neutral-500" aria-hidden="true" />
            <Text size="sm" weight="semibold">
              Shared Teams
            </Text>
          </div>
          <ul className="space-y-2">
            {profile.sharedTeams.map((team) => (
              <li key={team.id} className="flex items-center gap-2">
                <Text size="sm">{team.name}</Text>
                {team.isAdmin && (
                  <Badge variant="warning" size="sm" icon={<FontAwesomeIcon icon={faCrown} />}>
                    Admin
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </AppPage>
  );
};
