import { useState, useEffect } from 'react';
import { HuddleComposer } from '../features/huddle/HuddleComposer';
import { PostCard } from '../features/huddle/PostCard';
import type { ComposerContent } from '../features/huddle/types';
import { useSession } from '@lib/useSession';
import { useTeam } from '@lib/TeamContext';
import { teamApi, type HuddlePost, type Team } from '@lib/api';
import { getDdpClient } from '@lib/ddp';

function getUserInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

function getUserColor(userId: string): 'indigo' | 'teal' | 'coral' | 'amber' | 'pink' | 'green' {
  const colors: Array<'indigo' | 'teal' | 'coral' | 'amber' | 'pink' | 'green'> = [
    'indigo',
    'teal',
    'coral',
    'amber',
    'pink',
    'green',
  ];
  const hash = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

export default function Huddle() {
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
        .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime())
        .map((p) => ({ ...p, id: (p.id ?? p._id) as string }));
      setPosts(teamPosts as HuddlePost[]);
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
      const attachments = content.attachments.map((att) => {
        // Map MediaItem type to attachment type
        let type: 'image' | 'video' | 'file';
        if (att.type === 'image') {
          type = 'image';
        } else if (att.type === 'video') {
          type = 'video';
        } else if (att.type === 'document') {
          type = 'file';
        } else {
          // Fallback based on mimeType
          type = att.mimeType?.startsWith('image/') ? 'image' : 'file';
        }

        return {
          mediaId: att.id,
          type,
          url: att.url,
          filename: att.filename,
        };
      });

      // Extract user IDs from mentions
      const mentionUserIds = (content.mentions || []).map((m) => m.userId);

      // Call DDP method to create post
      await getDdpClient().call('huddle.createPost', {
        teamId: selectedTeamId,
        content: { text: content.text, mentions: mentionUserIds },
        ticketId: content.ticketId,
        attachments,
      });

      // DDP subscription will automatically reflect the new post
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
    <div className="flex flex-col h-full bg-gray-50 dark:bg-neutral-900 min-h-screen">
      {/* Sticky header section with both title and composer */}
      <div className="sticky top-0 z-10 bg-white dark:bg-neutral-800 shrink-0">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-neutral-700">
          <h1 className="text-lg font-semibold text-gray-900 dark:text-neutral-100 tracking-tight">
            Huddle
          </h1>
          <div className="flex gap-2">
            <button
              onClick={() => setShowSearch(!showSearch)}
              className="w-8 h-8 rounded-full bg-gray-100 dark:bg-neutral-700 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-neutral-600 transition-colors"
              title="Search posts"
            >
              <svg
                className="w-4 h-4 text-gray-500 dark:text-neutral-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </button>
            <a
              href="/app/notifications"
              className="w-8 h-8 rounded-full bg-gray-100 dark:bg-neutral-700 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-neutral-600 transition-colors"
              title="Notifications"
            >
              <svg
                className="w-4 h-4 text-gray-500 dark:text-neutral-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                />
              </svg>
            </a>
          </div>
        </div>

        {/* Search bar (shows when search button clicked) */}
        {showSearch && (
          <div className="px-5 py-3 border-b border-gray-100 dark:border-neutral-700 bg-gray-50 dark:bg-neutral-900">
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search posts..."
                className="w-full px-4 py-2 pl-10 text-sm bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-neutral-500"
                autoFocus
              />
              <svg
                className="absolute left-3 top-2.5 w-4 h-4 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
          </div>
        )}

        {/* Composer - part of sticky section */}
        {selectedTeamId && (
          <HuddleComposer
            onPost={addPost}
            userInitials={user ? getUserInitials(user.name) : 'U'}
            userColor={user ? getUserColor(user.id) : 'indigo'}
          />
        )}
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto">
        {!selectedTeamId && (
          <div className="flex items-center justify-center py-16 px-4">
            <p className="text-sm text-gray-500 dark:text-neutral-400">
              Please select a team to view the huddle feed
            </p>
          </div>
        )}

        {selectedTeamId && (
          <>
            <div className="h-2 bg-gray-100 dark:bg-neutral-800 border-y border-gray-200 dark:border-neutral-700" />

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
  );
}
