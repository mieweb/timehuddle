/**
 * ProfilePage — Public profile view + own-profile edit form.
 *
 * • Owner sees an inline edit form (displayName, bio, website)
 * • Teammates can view each other's profiles (enforced server-side)
 * • 403 → graceful "profile unavailable" fallback
 * • Shared team context shown when viewing a teammate's profile
 * • Data fetched from timecore GET /v1/users/:id and PUT /v1/me/profile
 */
import { faCrown, faGlobe, faPen, faUsers } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Avatar, Badge, Button, Card, Input, Spinner, Text } from '@mieweb/ui';
import React, { useEffect, useState } from 'react';

import {
  PROFILE_BIO_MAX,
  PROFILE_DISPLAY_NAME_MAX,
  PROFILE_WEBSITE_MAX,
} from '../../lib/constants';
import { ApiError, authApi, userApi, type AuthAccount, type PublicUser } from '../../lib/api';
import { useSession } from '../../lib/useSession';
import { AppPage } from '../../ui/AppPage';

interface ProfilePageProps {
  userId: string;
}

export const ProfilePage: React.FC<ProfilePageProps> = ({ userId }) => {
  const { user: sessionUser, refetch: refetchSession } = useSession();
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

  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [website, setWebsite] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AuthAccount[]>([]);
  const [accountsReady, setAccountsReady] = useState(false);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [githubBusy, setGithubBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [sendingReset, setSendingReset] = useState(false);

  useEffect(() => {
    if (!isOwn) {
      setAccounts([]);
      setAccountsReady(false);
      setAccountsError(null);
      return;
    }

    setAccountsReady(false);
    setAccountsError(null);

    authApi
      .listAccounts()
      .then((list) => setAccounts(list))
      .catch((err) => {
        setAccounts([]);
        setAccountsError(err instanceof Error ? err.message : 'Unable to load sign-in methods');
      })
      .finally(() => setAccountsReady(true));
  }, [isOwn]);

  const startEdit = () => {
    setDisplayName(profile?.name ?? '');
    setBio(profile?.bio ?? '');
    setWebsite(profile?.website ?? '');
    setSaveError(null);
    setEditing(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await userApi.updateProfile({
        name: displayName.trim() || undefined,
        bio: bio.trim(),
        website: website.trim(),
      });
      setProfile(updated);
      await refetchSession();
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  const refreshAccounts = async () => {
    const list = await authApi.listAccounts();
    setAccounts(list);
  };

  const connectGitHub = async () => {
    if (githubBusy) return;
    setAuthMessage(null);
    setGithubBusy(true);
    try {
      const callbackURL = `${window.location.origin}/app/profile/${userId}`;
      const url = await authApi.linkSocial('github', callbackURL);
      window.location.href = url;
    } catch (err) {
      setAuthMessage(err instanceof Error ? err.message : 'Failed to connect GitHub');
      setGithubBusy(false);
    }
  };

  const disconnectGitHub = async () => {
    if (githubBusy) return;
    setAuthMessage(null);
    setGithubBusy(true);
    try {
      await authApi.unlinkAccount('github');
      await refreshAccounts();
      setAuthMessage('GitHub disconnected.');
    } catch (err) {
      setAuthMessage(err instanceof Error ? err.message : 'Failed to disconnect GitHub');
    } finally {
      setGithubBusy(false);
    }
  };

  const sendPasswordSetupEmail = async () => {
    if (!sessionUser?.email || sendingReset) return;
    setAuthMessage(null);
    setSendingReset(true);
    try {
      await authApi.requestPasswordReset(sessionUser.email, `${window.location.origin}/app`);
      setAuthMessage('Password setup email sent. Check your inbox.');
    } catch (err) {
      setAuthMessage(err instanceof Error ? err.message : 'Failed to send password setup email');
    } finally {
      setSendingReset(false);
    }
  };

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
  const hasGitHub = accounts.some((a) => a.providerId === 'github');
  const hasCredential = accounts.some((a) => a.providerId === 'credential');
  const canDisconnectGitHub = hasGitHub && accounts.length > 1;

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

          {isOwn && !profile?.name && !profile?.bio && !editing && (
            <Text variant="muted" size="xs" className="mt-2">
              Your profile is empty. Click edit to add a display name and bio.
            </Text>
          )}
        </div>

        {isOwn && !editing && (
          <Button variant="outline" size="icon" onClick={startEdit} aria-label="Edit profile">
            <FontAwesomeIcon icon={faPen} className="text-xs" />
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

      {/* Sign-in methods — own profile only */}
      {isOwn && (
        <Card padding="lg" className="space-y-3">
          <Text as="h2" size="sm" weight="semibold">
            Sign-in Methods
          </Text>

          {!accountsReady ? (
            <Text variant="muted" size="sm">
              Loading sign-in methods…
            </Text>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <Text size="sm" weight="medium">
                    GitHub
                  </Text>
                  <Text variant="muted" size="xs">
                    {hasGitHub ? 'Connected' : 'Not connected'}
                  </Text>
                </div>

                {hasGitHub ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={disconnectGitHub}
                    isLoading={githubBusy}
                    loadingText="Disconnecting…"
                    disabled={!canDisconnectGitHub || githubBusy || sendingReset}
                  >
                    Disconnect
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={connectGitHub}
                    isLoading={githubBusy}
                    loadingText="Connecting…"
                    disabled={githubBusy || sendingReset}
                  >
                    Connect
                  </Button>
                )}
              </div>

              {hasGitHub && !canDisconnectGitHub && (
                <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-900/40">
                  <Text size="xs" variant="muted">
                    To disconnect GitHub, add another sign-in method first.
                  </Text>
                  {!hasCredential && (
                    <div className="mt-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={sendPasswordSetupEmail}
                        isLoading={sendingReset}
                        loadingText="Sending…"
                        disabled={githubBusy || sendingReset}
                      >
                        Set Password via Email
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {accountsError && (
                <Text variant="destructive" size="xs">
                  {accountsError}
                </Text>
              )}

              {authMessage && (
                <Text size="xs" variant="muted">
                  {authMessage}
                </Text>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Edit form — own profile only */}
      {isOwn && editing && (
        <Card padding="lg">
          <form onSubmit={save} className="space-y-4">
            <Text as="h2" size="sm" weight="semibold">
              Edit Profile
            </Text>

            <Input
              label="Display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={PROFILE_DISPLAY_NAME_MAX}
              placeholder="Your name"
            />

            <div className="space-y-1">
              <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400">
                Bio
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                maxLength={PROFILE_BIO_MAX}
                rows={3}
                placeholder="A short bio…"
                className="w-full resize-none rounded-lg border border-neutral-200 bg-transparent px-3 py-2 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-neutral-700 dark:text-neutral-100"
              />
            </div>

            <Input
              label="Website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              maxLength={PROFILE_WEBSITE_MAX}
              placeholder="https://yoursite.com"
              type="url"
            />

            {saveError && (
              <Text variant="destructive" size="xs">
                {saveError}
              </Text>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" isLoading={saving} loadingText="Saving…">
                Save
              </Button>
            </div>
          </form>
        </Card>
      )}
    </AppPage>
  );
};
