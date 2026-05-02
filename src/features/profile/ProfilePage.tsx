/**
 * ProfilePage — Read-only profile view (used within the authenticated app shell).
 *
 * • Teammates can view each other's profiles (enforced server-side).
 * • 403 → graceful "profile unavailable" fallback.
 * • Shared team context shown when viewing a teammate's profile.
 * • Owner sees a link to /app/settings to edit their profile.
 * • All editing is handled in SettingsPage — no inline edit form here.
 */
import { faCrown, faGear, faGlobe, faUsers } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Avatar, Badge, Button, Card, Spinner, Text } from '@mieweb/ui';
import React, { useEffect, useState } from 'react';

import { ApiError, userApi, type PublicUser } from '../../lib/api';
import { useSession } from '../../lib/useSession';
import { useRouter } from '../../ui/router';

interface ProfilePageProps {
  userId: string;
}

export const ProfilePage: React.FC<ProfilePageProps> = ({ userId }) => {
  const { user: sessionUser } = useSession();
  const { navigate } = useRouter();
  const isOwn = sessionUser?.id === userId;

  const [profile, setProfile] = useState<PublicUser | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isForbidden, setIsForbidden] = useState(false);

  useEffect(() => {
    setIsReady(false);
    setIsForbidden(false);
    userApi
      .getUser(userId)
      .then((p) => setProfile(p))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) {
          setIsForbidden(true);
        }
        setProfile(null);
      })
      .finally(() => setIsReady(true));
  }, [userId]);

  if (!isReady) {
    return (
      <div className="flex flex-1 items-center justify-center p-10">
        <Spinner size="lg" label="Loading…" />
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
    <div className="w-full space-y-6 p-6">
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
    </div>
  );
};
