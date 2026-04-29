/**
 * ProfilePage — Public profile view + own-profile edit form.
 *
 * • Any authenticated user can view any profile by userId
 * • The profile owner sees an inline edit form (displayName, bio, website)
 * • Data fetched from timecore GET /v1/users/:id and PUT /v1/me/profile
 */
import { faGlobe, faPen } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Avatar, Button, Card, Input, Spinner, Text } from '@mieweb/ui';
import React, { useEffect, useState } from 'react';

import {
  PROFILE_BIO_MAX,
  PROFILE_DISPLAY_NAME_MAX,
  PROFILE_WEBSITE_MAX,
} from '../../lib/constants';
import { userApi, type PublicUser } from '../../lib/api';
import { useSession } from '../../lib/useSession';

interface ProfilePageProps {
  userId: string;
}

export const ProfilePage: React.FC<ProfilePageProps> = ({ userId }) => {
  const { user: sessionUser, refetch: refetchSession } = useSession();
  const isOwn = sessionUser?.id === userId;

  const [profile, setProfile] = useState<PublicUser | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    setIsReady(false);
    userApi
      .getUser(userId)
      .then((p) => setProfile(p))
      .catch(() => setProfile(null))
      .finally(() => setIsReady(true));
  }, [userId]);

  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [website, setWebsite] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  if (!isReady) {
    return (
      <div className="flex flex-1 items-center justify-center p-10">
        <Spinner size="lg" label="Loading…" />
      </div>
    );
  }

  const nameText = profile?.name || sessionUser?.email?.split('@')[0] || 'Unknown user';
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      {/* Profile header card */}
      <Card padding="lg" className="flex items-start gap-5">
        <Avatar name={nameText} size="xl" />

        <div className="min-w-0 flex-1">
          <Text as="h1" size="xl" weight="bold">
            {nameText}
          </Text>

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
    </div>
  );
};
