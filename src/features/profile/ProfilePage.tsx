/**
 * ProfilePage — Read-only profile view (used within the authenticated app shell).
 *
 * • Teammates can view each other's profiles (enforced server-side).
 * • 403 → graceful "profile unavailable" fallback.
 * • Shared team context shown when viewing a teammate's profile.
 * • Owner sees a link to /app/settings to edit their profile.
 * • All editing is handled in SettingsPage — no inline edit form here.
 */
import { faArrowUpFromBracket, faCrown, faGear, faGlobe, faUser, faUsers } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Avatar, Badge, Button, Card, Spinner, Tabs, TabsContent, TabsList, TabsTrigger, Text } from '@mieweb/ui';
import React, { useEffect, useState } from 'react';

import { ApiError, userApi, type PublicUser } from '../../lib/api';
import { useSession } from '../../lib/useSession';
import { AppPage } from '../../ui/AppPage';
import { useRouter } from '../../ui/router';
import { ProfileActivityFeed } from './ProfileActivityFeed';
import { ProfileWorkSnapshot } from './ProfileWorkSnapshot';

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

      {/* Hero card */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-neutral-800 to-neutral-950 dark:from-neutral-900 dark:to-black shadow-lg">
        {/* Decorative background circles */}
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/5" aria-hidden />
        <div className="pointer-events-none absolute -left-10 bottom-0 h-40 w-40 rounded-full bg-white/[0.03]" aria-hidden />

        <div className="relative flex flex-col items-center gap-4 px-6 pb-8 pt-10 text-center sm:flex-row sm:items-end sm:gap-6 sm:px-10 sm:pb-8 sm:pt-10 sm:text-left">
          {/* Avatar */}
          <div className="shrink-0 rounded-2xl ring-4 ring-white/10">
            <Avatar name={nameText} size="xl" />
          </div>

          {/* Info */}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-bold text-white">
              {nameText}
            </h1>

            {profile?.username && (
              <p className="mt-0.5 text-sm text-neutral-400">@{profile.username}</p>
            )}

            {isOwn && sessionUser?.email && !profile?.username && (
              <p className="mt-0.5 text-sm text-neutral-400">{sessionUser.email}</p>
            )}

            {profile?.bio && (
              <p className="mt-2 max-w-prose text-sm text-neutral-300">{profile.bio}</p>
            )}

            {profile?.website && (
              <a
                href={profile.website}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 hover:underline"
              >
                <FontAwesomeIcon icon={faGlobe} className="shrink-0 text-xs" />
                {profile.website.replace(/^https?:\/\//, '')}
              </a>
            )}

            {isOwn && !profile?.name && !profile?.bio && (
              <p className="mt-2 text-xs text-neutral-500">
                Your profile is empty. Go to Settings to add a display name and bio.
              </p>
            )}
          </div>

          {/* Edit button */}
          {isOwn && (
            <div className="shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/app/settings')}
                aria-label="Edit profile in Settings"
                leftIcon={<FontAwesomeIcon icon={faGear} className="text-xs" />}
                className="border-white/20 text-white hover:bg-white/10"
              >
                Edit
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Tab rail — Work | Activity */}
      {profile && (
        <Tabs defaultValue="work" className="w-full">
          <TabsList className="mb-4 w-full">
            <TabsTrigger value="work" className="flex-1">Work</TabsTrigger>
            <TabsTrigger value="activity" className="flex-1">Activity</TabsTrigger>
          </TabsList>

          {/* Work tab */}
          <TabsContent value="work" className="flex flex-col gap-4">
            <ProfileWorkSnapshot
              userId={profile.id}
              teams={
                isOwn
                  ? profile.teamMemberships.map((t) => ({ id: t.id, name: t.name }))
                  : (profile.sharedTeams ?? []).map((t) => ({ id: t.id, name: t.name }))
              }
            />

            {/* Working Context — own profile only, inside Work tab */}
            {isOwn && (
              <Card padding="lg">
                <div className="mb-5 flex items-center gap-2 border-b border-neutral-200 pb-3 dark:border-neutral-700">
                  <FontAwesomeIcon icon={faUser} className="text-neutral-400" aria-hidden="true" />
                  <Text size="sm" weight="semibold" className="uppercase tracking-widest text-neutral-500 dark:text-neutral-400">
                    Working Context
                  </Text>
                </div>
                <div className="grid gap-6 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
                  <div>
                    <Text variant="muted" size="xs" className="mb-2 block uppercase tracking-widest">Reports To</Text>
                    {profile.reportsTo ? (
                      <div className="flex items-center gap-3 rounded-lg bg-neutral-50 px-3 py-2 dark:bg-neutral-800">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-neutral-500 dark:bg-neutral-700">
                          <FontAwesomeIcon icon={faArrowUpFromBracket} className="text-xs" aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                          <Text size="sm" weight="medium" className="truncate">{profile.reportsTo.name}</Text>
                          {profile.reportsTo.username && (
                            <Text variant="muted" size="xs" className="truncate">@{profile.reportsTo.username}</Text>
                          )}
                        </div>
                      </div>
                    ) : (
                      <Text variant="muted" size="sm">Not set</Text>
                    )}
                  </div>
                  <div>
                    <Text variant="muted" size="xs" className="mb-2 block uppercase tracking-widest">Team Memberships</Text>
                    {profile.teamMemberships.length > 0 ? (
                      <ul className="flex flex-col gap-2">
                        {profile.teamMemberships.map((team) => (
                          <li key={team.id} className="flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-2 dark:bg-neutral-800">
                            <Text size="sm" weight="medium">{team.name}</Text>
                            <Badge variant={team.role === 'admin' ? 'warning' : 'secondary'} size="sm">
                              {team.role === 'admin' ? 'Admin' : 'Member'}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <Text variant="muted" size="sm">No team memberships yet.</Text>
                    )}
                  </div>
                </div>
              </Card>
            )}

            {/* Shared teams — teammate view, inside Work tab */}
            {!isOwn && profile.sharedTeams && profile.sharedTeams.length > 0 && (
              <Card padding="lg">
                <div className="mb-4 flex items-center gap-2 border-b border-neutral-200 pb-3 dark:border-neutral-700">
                  <FontAwesomeIcon icon={faUsers} className="text-neutral-400" aria-hidden="true" />
                  <Text size="sm" weight="semibold" className="uppercase tracking-widest text-neutral-500 dark:text-neutral-400">
                    Shared Teams
                  </Text>
                </div>
                <ul className="flex flex-col gap-2">
                  {profile.sharedTeams.map((team) => (
                    <li
                      key={team.id}
                      className="flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-2 dark:bg-neutral-800"
                    >
                      <Text size="sm" weight="medium">{team.name}</Text>
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
          </TabsContent>

          {/* Activity tab */}
          <TabsContent value="activity">
            <ProfileActivityFeed userId={profile.id} />
          </TabsContent>
        </Tabs>
      )}
    </AppPage>
  );
};
