import { faBell, faComments, faMagnifyingGlass, faTableList } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Input } from '@mieweb/ui';
import { SuperChat } from '@mieweb/ui/components/SuperChat';
import {
  createCodePlugin,
  createImagePlugin,
  createMermaidPlugin,
} from '@mieweb/ui/components/SuperChat/plugins';
import { useMemo, useState, useEffect } from 'react';
import { HuddleComposer } from '../features/huddle/HuddleComposer';
import { DraftsPanel } from '../features/huddle/DraftsPanel';
import { PostCard } from '../features/huddle/PostCard';
import { toPostAttachment } from '../features/huddle/api';
import { getUserColor, getUserInitials } from '../features/huddle/avatar';
import { postsToConversation } from '../features/huddle/superChatFeed';
import type { ComposerContent } from '../features/huddle/types';
import { AppPage } from '../ui/AppPage';
import { useRouter } from '../ui/router';
import { useSession } from '@lib/useSession';
import { useTeam } from '@lib/TeamContext';
import { teamApi, huddleApi, type HuddlePost, type Team } from '@lib/api';
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
  // Top-level tab: the team feed or the user's private drafts.
  const [feedTab, setFeedTab] = useState<'feed' | 'drafts'>('feed');
  // Feed view: SuperChat thread (default) or the classic card view — the
  // card view keeps per-post comments/likes, which SuperChat has no
  // per-message-thread concept for (deliberately not force-fit).
  const [feedView, setFeedView] = useState<'chat' | 'cards'>('chat');
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

      // Extract user IDs from mentions
      const mentionUserIds = (content.mentions || []).map((m) => m.userId);

      // Prepare attachments for API
      const attachments = content.attachments.map(toPostAttachment);

      // Always create a new post — session plan/wrap-up editing happens on the
      // Clock page (one post per session).
      await getDdpClient().call('huddle.createPost', {
        teamId: selectedTeamId,
        content: { text: content.text, mentions: mentionUserIds },
        ticketId: content.ticketId,
        attachments,
        postDate: toDateString(new Date()),
      });

      // The DDP subscription reflects the new post automatically.
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

  const filteredPosts = posts.filter((post) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      post.content.text.toLowerCase().includes(query) ||
      post.userName?.toLowerCase().includes(query) ||
      post.ticketTitle?.toLowerCase().includes(query)
    );
  });

  // ── SuperChat mapping (memoized — posts update via DDP) ──
  // Keyed by an id:updatedAt fingerprint instead of the array identity,
  // because filteredPosts is a fresh array every render.
  const conversationKey = filteredPosts.map((p) => `${p.id}:${p.updatedAt}`).join(',');
  const conversation = useMemo(
    () => postsToConversation(selectedTeamId ?? 'huddle', team?.name ?? 'Huddle', filteredPosts),
    [selectedTeamId, team?.name, conversationKey],
  );
  const renderPlugins = useMemo(
    () => [createCodePlugin(), createImagePlugin(), createMermaidPlugin()],
    [],
  );

  // Inline edit from the feed (self-authored messages only) → huddle.updatePost
  async function handleMessageEdited(messageId: string, text: string) {
    const post = posts.find((p) => p.id === messageId);
    if (!post) return;
    try {
      await huddleApi.updatePost(messageId, { text, mentions: post.content.mentions });
    } catch (err) {
      console.error('[Huddle] Failed to save edit:', err);
      alert('Failed to save the edit. Please try again.');
    }
  }

  return (
    <AppPage fill>
      <div className="huddle flex h-full min-h-0 flex-col gap-4">
        {/* Feed / Drafts tabs + actions */}
        <div className="huddle-actions flex shrink-0 items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-800">
            <button
              type="button"
              onClick={() => setFeedTab('feed')}
              className={[
                'rounded-md px-3 py-1 text-sm font-medium transition-colors',
                feedTab === 'feed'
                  ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
                  : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300',
              ].join(' ')}
              aria-pressed={feedTab === 'feed'}
            >
              Feed
            </button>
            <button
              type="button"
              onClick={() => setFeedTab('drafts')}
              className={[
                'rounded-md px-3 py-1 text-sm font-medium transition-colors',
                feedTab === 'drafts'
                  ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
                  : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300',
              ].join(' ')}
              aria-pressed={feedTab === 'drafts'}
            >
              Drafts
            </button>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {feedTab === 'feed' && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setFeedView(feedView === 'chat' ? 'cards' : 'chat')}
                  aria-label={feedView === 'chat' ? 'Switch to card view' : 'Switch to chat view'}
                  title={
                    feedView === 'chat'
                      ? 'Card view (comments & likes)'
                      : 'Chat view (rich thread)'
                  }
                >
                  <FontAwesomeIcon icon={feedView === 'chat' ? faTableList : faComments} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowSearch(!showSearch)}
                  aria-label="Search posts"
                  title="Search posts"
                >
                  <FontAwesomeIcon icon={faMagnifyingGlass} />
                </Button>
              </>
            )}
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
        </div>

        {showSearch && feedTab === 'feed' && (
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

        {/* Drafts tab — private, multiple drafts */}
        {selectedTeamId && feedTab === 'drafts' && user && (
          <DraftsPanel
            teamId={selectedTeamId}
            userInitials={getUserInitials(user.name)}
            userColor={getUserColor(user.id)}
          />
        )}

        {/* Composer stays put while the feed below it scrolls */}
        {selectedTeamId && feedTab === 'feed' && (
          <div className="huddle-composer shrink-0">
            <HuddleComposer
              onPost={addPost}
              userInitials={user ? getUserInitials(user.name) : 'U'}
              userColor={user ? getUserColor(user.id) : 'indigo'}
            />
          </div>
        )}

        {/* Feed */}
        {feedTab === 'feed' && (
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

              {/* Chat view — SuperChat thread (newest-first, read-only
                  composer: authoring goes through the RichEditor above) */}
              {!loading && !error && user && posts.length > 0 && feedView === 'chat' && (
                <SuperChat
                  conversation={conversation}
                  currentParticipantId={user.id}
                  order="desc"
                  readOnly
                  virtualized
                  renderPlugins={renderPlugins}
                  onMessageEdited={(messageId, text) => void handleMessageEdited(messageId, text)}
                  className="h-full"
                />
              )}

              {/* Classic card view — keeps per-post comments and likes */}
              {!loading &&
                !error &&
                user &&
                feedView === 'cards' &&
                filteredPosts.map((post) => (
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
        )}
      </div>
    </AppPage>
  );
}
