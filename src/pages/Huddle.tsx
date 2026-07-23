import { faBell, faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Input } from '@mieweb/ui';
import { useState, useEffect } from 'react';
import { HuddleComposer } from '../features/huddle/HuddleComposer';
import { PostCard } from '../features/huddle/PostCard';
import { toPostAttachment } from '../features/huddle/api';
import { getUserColor, getUserInitials } from '../features/huddle/avatar';
import type { ComposerContent } from '../features/huddle/types';
import { AppPage } from '../ui/AppPage';
import { useRouter } from '../ui/router';
import { useSession } from '@lib/useSession';
import { useTeam } from '@lib/TeamContext';
import { teamApi, type HuddlePost, type Team } from '@lib/api';
import { getDdpClient } from '@lib/ddp';
import { toDateString } from '@lib/timeUtils';

export default function Huddle() {
  const { navigate } = useRouter();
  const [posts, setPosts] = useState<HuddlePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [team, setTeam] = useState<Team | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { user } = useSession();
  const { selectedTeamId } = useTeam();

  // Load team data for permission checks
  useEffect(() => {
    async function loadTeam() {
      if (!selectedTeamId) {
        setTeam(null);
        return;
      }

      try {
        const teams = await teamApi.getTeamsOnly();
        const foundTeam = teams.find((t) => t.id === selectedTeamId);
        setTeam(foundTeam || null);
      } catch (err) {
        console.error('[Huddle] Failed to load team:', err);
      }
    }

    loadTeam();
  }, [selectedTeamId]);

  // Subscribe to live DDP publication for huddle posts
  useEffect(() => {
    if (!selectedTeamId) {
      setPosts([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const ddp = getDdpClient();
    const unsub = ddp.subscribe('huddlePosts.byTeam', [selectedTeamId], () => setLoading(false));

    // Helper to sync collection → state
    function syncPosts() {
      const docs = ddp.docs('huddlePosts');
      const teamPosts = docs
        .filter((p) => p.teamId === selectedTeamId)
        .sort(
          (a, b) =>
            new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime(),
        )
        .map((p) => ({ ...p, id: (p.id ?? p._id) as string })) as unknown as HuddlePost[];
      setPosts(teamPosts);
    }

    // Sync immediately in case data is already cached
    syncPosts();

    // Then keep syncing on every change
    const offChange = ddp.onCollectionChange('huddlePosts', syncPosts);

    const loadingFallback = setTimeout(() => setLoading(false), 3000);

    return () => {
      clearTimeout(loadingFallback);
      unsub();
      offChange();
      setPosts([]);
    };
  }, [selectedTeamId]);

  async function addPost(content: ComposerContent) {
    try {
      if (!user || !selectedTeamId) {
        alert('Please select a team first');
        return;
      }

      // Prepare attachments for API
      const attachments = content.attachments.map(toPostAttachment);

      // Extract user IDs from mentions
      const mentionUserIds = (content.mentions || []).map((m) => m.userId);

      // Call DDP method to create post
      await getDdpClient().call('huddle.createPost', {
        teamId: selectedTeamId,
        content: { text: content.text, mentions: mentionUserIds },
        ticketId: content.ticketId,
        attachments,
        postDate: toDateString(new Date()),
      });

      // DDP subscription will automatically reflect the new post; the clock-in
      // gate (useDailyPost) listens for this event to flip live.
      window.dispatchEvent(new CustomEvent('huddle:refetch'));
    } catch (error) {
      console.error('[Huddle] Error in addPost:', error);
      alert('Failed to create post. Please try again.');
    }
  }

  // Determine permissions for each post
  function canEditPost(post: HuddlePost): boolean {
    if (!user || !team) return false;
    const isAuthor = post.userId === user.id;
    const isTeamAdmin = team.admins.includes(user.id);
    const isOrgOwner =
      user.organizationMembership?.role === 'owner' &&
      user.organizationMembership?.organizationId === team.orgId;
    return isAuthor || isTeamAdmin || isOrgOwner;
  }

  function canDeletePost(post: HuddlePost): boolean {
    // Same permissions as edit
    return canEditPost(post);
  }

  return (
    <AppPage fill>
      <div className="huddle flex h-full min-h-0 flex-col gap-4">
        {/* Feed actions — the page name comes from AppPage's shared PageTitle */}
        <div className="huddle-actions flex shrink-0 items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowSearch(!showSearch)}
            aria-label="Search posts"
            title="Search posts"
          >
            <FontAwesomeIcon icon={faMagnifyingGlass} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/app/notifications')}
            aria-label="Notifications"
            title="Notifications"
          >
            <FontAwesomeIcon icon={faBell} />
          </Button>
        </div>

        {showSearch && (
          <Input
            label="Search posts"
            hideLabel
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search posts…"
            className="shrink-0"
            autoFocus
          />
        )}

        {/* Composer stays put while the feed below it scrolls */}
        {selectedTeamId && (
          <div className="huddle-composer shrink-0">
            <HuddleComposer
              onPost={addPost}
              userInitials={user ? getUserInitials(user.name) : 'U'}
              userColor={user ? getUserColor(user.id) : 'indigo'}
            />
          </div>
        )}

        {/* Feed */}
        <div className="huddle-feed min-h-0 flex-1 overflow-y-auto">
          {!selectedTeamId && (
            <div className="flex items-center justify-center py-16 px-4">
              <p className="text-sm text-gray-500 dark:text-neutral-400">
                Please select a team to view the huddle feed
              </p>
            </div>
          )}

          {selectedTeamId && (
            <>
              {loading && (
                <div className="flex items-center justify-center py-16">
                  <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                </div>
              )}

              {error && (
                <div className="flex items-center justify-center py-16 px-4">
                  <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
                </div>
              )}

              {!loading && !error && posts.length === 0 && (
                <div className="flex items-center justify-center py-16 px-4">
                  <p className="text-sm text-gray-500 dark:text-neutral-400">
                    No posts yet. Be the first to share!
                  </p>
                </div>
              )}

              {!loading &&
                !error &&
                user &&
                posts
                  .filter((post) => {
                    if (!searchQuery.trim()) return true;
                    const query = searchQuery.toLowerCase();
                    return (
                      post.content.text.toLowerCase().includes(query) ||
                      post.userName?.toLowerCase().includes(query) ||
                      post.ticketTitle?.toLowerCase().includes(query)
                    );
                  })
                  .map((post) => (
                    <PostCard
                      key={post.id}
                      post={post}
                      currentUserId={user?.id ?? ''}
                      canEdit={canEditPost(post)}
                      canDelete={canDeletePost(post)}
                    />
                  ))}
            </>
          )}
        </div>
      </div>
    </AppPage>
  );
}
