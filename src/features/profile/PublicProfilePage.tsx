/**
 * PublicProfilePage — Read-only public profile accessible at /:username.
 *
 * • No auth required — unauthenticated users can view the page.
 * • When viewer is authenticated, shared teams are shown.
 * • 404 fallback for unknown usernames.
 * • Authenticated owners see a link to /app/settings to edit their profile.
 */
import { faGlobe, faUsers, faCrown } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Avatar, Badge, Button, Card, Spinner, Text } from '@mieweb/ui';
import React, { useEffect, useState } from 'react';

import { ApiError, userApi, type PublicUser } from '../../lib/api';
import { useSession } from '../../lib/useSession';

interface PublicProfilePageProps {
  username: string;
}

export const PublicProfilePage: React.FC<PublicProfilePageProps> = ({ username }) => {
  const { user: sessionUser } = useSession();

  const [profile, setProfile] = useState<PublicUser | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isNotFound, setIsNotFound] = useState(false);

  useEffect(() => {
    setIsReady(false);
    setIsNotFound(false);
    setProfile(null);
    userApi
      .getUserByUsername(username)
      .then((p) => setProfile(p))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) {
          setIsNotFound(true);
        }
        setProfile(null);
      })
      .finally(() => setIsReady(true));
  }, [username]);

  if (!isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center p-10">
        <Spinner size="lg" label="Loading…" />
      </div>
    );
  }

  if (isNotFound || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Card padding="lg" className="flex max-w-sm flex-col items-center gap-4 text-center">
          <Text as="h1" size="xl" weight="bold">
            Profile Not Found
          </Text>
          <Text variant="muted" size="sm">
            No user with the username <strong>@{username}</strong> exists.
          </Text>
          <Button variant="outline" size="sm" onClick={() => (window.location.href = '/')}>
            Go Home
          </Button>
        </Card>
      </div>
    );
  }

  const isOwn = sessionUser?.id === profile.id;
  const nameText = profile.name || `@${username}`;

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 py-10 px-4">
      <div className="mx-auto max-w-lg space-y-6">
        {/* Profile header card */}
        <Card padding="lg" className="flex items-start gap-5">
          <Avatar name={nameText} size="xl" />

          <div className="min-w-0 flex-1">
            <Text as="h1" size="xl" weight="bold">
              {nameText}
            </Text>

            <Text variant="muted" size="sm" className="mt-0.5">
              @{username}
            </Text>

            {profile.bio && (
              <Text size="sm" className="mt-2">
                {profile.bio}
              </Text>
            )}

            {profile.website && (
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
          </div>

          {isOwn && (
            <Button
              variant="outline"
              size="sm"
              // Full navigation: /app/settings is in the authenticated app SPA mount
              onClick={() => (window.location.href = '/app/settings')}
              aria-label="Edit your profile in Settings"
            >
              Edit
            </Button>
          )}
        </Card>

        {/* Shared teams — only visible when viewer is authenticated and viewing a teammate */}
        {!isOwn && profile.sharedTeams && profile.sharedTeams.length > 0 && (
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
    </div>
  );
};
