/**
 * ProfilePage — Public profile view + own-profile edit form.
 *
 * • Any authenticated user can view any profile by userId
 * • The profile owner sees an inline edit form (displayName, bio, website)
 * • Avatar, displayName, bio and website are the editable public fields
 *
 * Subscriptions: 'profile.public' for the viewed userId
 */
import { faGlobe, faPen } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Avatar, Button, Card, Input, Spinner, Text } from '@mieweb/ui';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import React, { useState } from 'react';

import {
  PROFILE_BIO_MAX,
  PROFILE_DISPLAY_NAME_MAX,
  PROFILE_WEBSITE_MAX,
} from '../../lib/constants';
import { useMethod } from '../../lib/useMethod';
import { UserProfiles } from './api';
import { type ProfileUpdateInput } from './schema';

interface ProfilePageProps {
  userId: string;
}

export const ProfilePage: React.FC<ProfilePageProps> = ({ userId }) => {
  const myId = useTracker(() => Meteor.userId(), []);
  const isOwn = myId === userId;

  const { profile, isReady } = useTracker(() => {
    const handle = Meteor.subscribe('profile.public', userId);
    return {
      profile: UserProfiles.findOne({ userId }),
      isReady: handle.ready(),
    };
  }, [userId]);

  const email = useTracker(() => {
    if (!isOwn) return null;
    const user = Meteor.user();
    return user?.emails?.[0]?.address ?? null;
  }, [isOwn]);

  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [website, setWebsite] = useState('');
  const updateProfile = useMethod<[ProfileUpdateInput]>('profile.update');

  const startEdit = () => {
    setDisplayName(profile?.displayName ?? '');
    setBio(profile?.bio ?? '');
    setWebsite(profile?.website ?? '');
    updateProfile.clearError();
    setEditing(true);
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    updateProfile
      .call({ displayName, bio, website })
      .then(() => setEditing(false))
      .catch(() => {}); // error shown via updateProfile.error
  };

  if (!isReady) {
    return (
      <div className="flex flex-1 items-center justify-center p-10">
        <Spinner size="lg" label="Loading…" />
      </div>
    );
  }

  // Determine what to display: prefer saved displayName, then email, then fallback
  const nameText = profile?.displayName || email || 'Unknown user';
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      {/* Profile header card */}
      <Card padding="lg" className="flex items-start gap-5">
        <Avatar name={nameText} size="xl" />

        <div className="min-w-0 flex-1">
          <Text as="h1" size="xl" weight="bold">{nameText}</Text>

          {isOwn && email && (
            <Text variant="muted" size="sm" className="mt-0.5">{email}</Text>
          )}

          {profile?.bio && (
            <Text size="sm" className="mt-2">{profile.bio}</Text>
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

          {isOwn && !profile?.displayName && !profile?.bio && !editing && (
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

            {updateProfile.error && <Text variant="destructive" size="xs">{updateProfile.error}</Text>}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                isLoading={updateProfile.loading}
                loadingText="Saving…"
              >
                Save
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
};
