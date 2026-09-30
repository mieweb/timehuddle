import { useMemo, type ReactNode } from 'react';
import type { HuddlePost } from '@lib/api';
import { useLiveClockEvents } from '@lib/ddp';
import { useSession } from '@lib/useSession';
import { useTeam } from '@lib/TeamContext';
import { PostCard } from './PostCard';

interface HuddleFeedProps {
  teamId: string;
  posts: HuddlePost[];
  /** Accessible name for the feed region, e.g. "Huddle posts". */
  label: string;
  /** Shown in place of the list when `posts` is empty. */
  emptyState?: ReactNode;
  highlightedPostId?: string | null;
}

/**
 * The Huddle post list — one `PostCard` per post, with the Huddle edit/delete
 * permissions and live clock-session state. Shared by the Huddle page and the
 * profile feed; the caller supplies the posts (see `useHuddlePosts`).
 */
export function HuddleFeed({
  teamId,
  posts,
  label,
  emptyState = null,
  highlightedPostId = null,
}: HuddleFeedProps) {
  const { user } = useSession();
  const { allTeams } = useTeam();
  const team = allTeams.find((t) => t.id === teamId) ?? null;

  // Live session state for the post headers. The posts publication only fires
  // on post writes, so a clock-out would never reach the feed on its own —
  // `clock.liveForTeams` carries every still-open session for the team.
  const liveTeamIds = useMemo(() => [teamId], [teamId]);
  const { docs: liveClockEvents } = useLiveClockEvents(liveTeamIds);
  const activeClockEventIds = useMemo(
    () => new Set(liveClockEvents.filter((d) => d.endTime == null).map((d) => d._id)),
    [liveClockEvents],
  );

  // Author, team admin, or org owner — delete uses the same rule as edit.
  function canEditPost(post: HuddlePost): boolean {
    if (!user || !team) return false;
    const isAuthor = post.userId === user.id;
    const isTeamAdmin = team.admins.includes(user.id);
    const isOrgOwner =
      user.organizationMembership?.role === 'owner' &&
      user.organizationMembership?.organizationId === team.orgId;
    return isAuthor || isTeamAdmin || isOrgOwner;
  }

  if (!user) return null;
  if (posts.length === 0) return <>{emptyState}</>;

  return (
    <section className="huddle-feed-list" aria-label={label}>
      {posts.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          currentUserId={user.id}
          canEdit={canEditPost(post)}
          canDelete={canEditPost(post)}
          highlighted={post.id === highlightedPostId}
          sessionActive={!!post.clockEventId && activeClockEventIds.has(post.clockEventId)}
        />
      ))}
    </section>
  );
}
