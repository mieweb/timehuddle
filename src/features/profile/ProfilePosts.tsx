/**
 * ProfilePosts — a person's Huddle posts in the currently selected team, shown
 * on their profile's Feed tab. Read-only feed: no composer, even on your own
 * profile. Rendered by the same `HuddleFeed` as the Huddle page, so edit/delete
 * permissions, comments and reactions behave identically.
 */
import { Spinner, Text } from '@mieweb/ui';
import React from 'react';

import { useTeam } from '../../lib/TeamContext';
import { HuddleFeed } from '../huddle/HuddleFeed';
import { useHuddlePosts } from '../huddle/useHuddlePosts';

interface ProfilePostsProps {
  userId: string;
}

const EmptyState: React.FC<{ message: string }> = ({ message }) => (
  <div className="profile-posts-empty flex items-center justify-center py-12 text-center">
    <Text variant="muted" size="sm">
      {message}
    </Text>
  </div>
);

export const ProfilePosts: React.FC<ProfilePostsProps> = ({ userId }) => {
  const { selectedTeamId } = useTeam();
  const { posts, loading, error } = useHuddlePosts({
    teamId: selectedTeamId,
    authorId: userId,
  });

  if (!selectedTeamId) return <EmptyState message="Select a team to see posts." />;

  if (loading) {
    return (
      <div className="profile-posts-loading flex items-center justify-center py-12">
        <Spinner size="lg" label="Loading posts…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="profile-posts-error py-12 text-center" role="alert">
        <Text size="sm" className="text-red-500">
          {error}
        </Text>
      </div>
    );
  }

  return (
    <HuddleFeed
      teamId={selectedTeamId}
      posts={posts}
      label="Huddle posts by this person"
      emptyState={<EmptyState message="No posts in this team yet." />}
    />
  );
};
