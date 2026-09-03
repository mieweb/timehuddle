import {
  faBell,
  faComments,
  faMagnifyingGlass,
  faTableList,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Input } from '@mieweb/ui';
import { SuperChat } from '@mieweb/ui/components/SuperChat';
import {
  createCodePlugin,
  createImagePlugin,
  createMermaidPlugin,
} from '@mieweb/ui/components/SuperChat/plugins';
import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
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
import { useRefresh } from '@lib/RefreshContext';
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
  // Feed view: the classic card view (default) or the SuperChat thread —
  // the card view keeps per-post comments/likes, which SuperChat has no
  // per-message-thread concept for (deliberately not force-fit).
  const [feedView, setFeedView] = useState<'chat' | 'cards'>('cards');
  const { user } = useSession();
  const { selectedTeamId } = useTeam();

  // Deep-link support: /app/huddle?postId=XXX (e.g. from the dashboard's
  // Recent Activity feed) — scroll to and briefly highlight that post once
  // it's loaded, then strip the query param.
  const [targetPostId, setTargetPostId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('postId');
  });
  const [highlightedPostId, setHighlightedPostId] = useState<string | null>(null);

  useEffect(() => {
    if (!targetPostId) return;
    setFeedTab('feed');
    setFeedView('cards');
  }, [targetPostId]);

  useEffect(() => {
    if (!targetPostId || loading) return;
    if (!posts.some((p) => p.id === targetPostId)) return;
    document
      .getElementById(`huddle-post-${targetPostId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedPostId(targetPostId);
    window.history.replaceState(null, '', window.location.pathname);
    setTargetPostId(null);
    const timer = setTimeout(() => setHighlightedPostId(null), 2500);
    return () => clearTimeout(timer);
  }, [targetPostId, loading, posts]);

  // Dismiss the highlight ring as soon as the user clicks/taps anywhere,
  // rather than waiting out the full timeout.
  useEffect(() => {
    if (!highlightedPostId) return;
    const clear = () => setHighlightedPostId(null);
    document.addEventListener('pointerdown', clear);
    return () => document.removeEventListener('pointerdown', clear);
  }, [highlightedPostId]);

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

  // Last REST snapshot for the team, replaced wholesale on every refetch (not
  // merged) so an edit or delete that happened while DDP was disconnected is
  // reflected, and a post absent from a later snapshot doesn't linger forever.
  const restPostsRef = useRef<Map<string, HuddlePost>>(new Map());

  // Build the feed from the DDP cache plus any pending overlay posts. Lifted to
  // component scope so addPost can trigger an immediate re-sync after posting.
  const syncPosts = useCallback(() => {
    if (!selectedTeamId) return;
    const ddp = getDdpClient();
    const byId = new Map<string, HuddlePost>();
    for (const p of ddp.docs('huddlePosts')) {
      if (p.teamId !== selectedTeamId) continue;
      const post = { ...p, id: (p.id ?? p._id) as string } as unknown as HuddlePost;
      byId.set(post.id, post);
    }
    // REST snapshot wins over the DDP cache when it's newer — DDP may be
    // holding a stale copy while the socket is disconnected (e.g. backgrounded
    // for a Pulse recording), so a plain "DDP always wins" merge would hide
    // REST-only edits indefinitely.
    for (const [id, restPost] of restPostsRef.current) {
      const ddpPost = byId.get(id);
      if (
        !ddpPost ||
        new Date(restPost.updatedAt).getTime() > new Date(ddpPost.updatedAt).getTime()
      ) {
        byId.set(id, restPost);
      }
    }
    const teamPosts = [...byId.values()].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    setPosts(teamPosts);
  }, [selectedTeamId]);

  // Fetch the feed over REST and overlay it. Used by pull-to-refresh and as a
  // fallback when the live DDP socket is down (dropped while backgrounded for a
  // Pulse recording), so the feed still updates without a reconnect.
  const refreshFeed = useCallback(async () => {
    if (!selectedTeamId) return;
    try {
      const fresh = await huddleApi.getPosts(selectedTeamId);
      restPostsRef.current = new Map(fresh.map((post) => [post.id, post]));
      syncPosts();
    } catch (err) {
      console.error('[Huddle] refreshFeed failed:', err);
    }
  }, [selectedTeamId, syncPosts]);

  // Wire pull-to-refresh (swipe down) to the REST refetch.
  useRefresh(refreshFeed);

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

    // Sync immediately in case data is already cached
    syncPosts();

    // REST fallback: populate the feed even if the DDP socket is down (it's
    // dropped while the app is backgrounded for a Pulse recording).
    refreshFeed().finally(() => setLoading(false));

    // Then keep syncing on every change
    const offChange = ddp.onCollectionChange('huddlePosts', syncPosts);

    const loadingFallback = setTimeout(() => setLoading(false), 3000);

    return () => {
      clearTimeout(loadingFallback);
      unsub();
      offChange();
      setPosts([]);
      restPostsRef.current.clear();
    };
  }, [selectedTeamId, syncPosts, refreshFeed]);

  async function addPost(content: ComposerContent) {
    if (!user || !selectedTeamId) {
      alert('Please select a team first');
      return;
    }

    const mentionUserIds = (content.mentions || []).map((m) => m.userId);
    const attachments = content.attachments.map(toPostAttachment);

    const { id } = await huddleApi.createPost({
      teamId: selectedTeamId,
      content: { text: content.text, mentions: mentionUserIds },
      ticketId: content.ticketId,
      attachments,
      postDate: toDateString(new Date()),
    });

    // Show the new post without waiting on the live DDP socket, which may be
    // down (dropped while the app was backgrounded for a Pulse recording):
    // refreshFeed refetches over REST and overlays the result, and syncPosts
    // drops the overlay once the subscription catches up.
    //
    // The retry condition is "not in the feed by *either* route". Waiting on
    // the DDP cache specifically would stall the full backoff on every post
    // whenever the socket is down — which is the exact case the REST overlay
    // exists to cover, and where the post is already on screen after the first
    // refresh.
    const ddp = getDdpClient();
    const inFeed = () =>
      restPostsRef.current.has(id) || ddp.docs('huddlePosts').some((p) => (p.id ?? p._id) === id);

    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await new Promise<void>((r) => setTimeout(r, 1500));
      await refreshFeed();
      if (inFeed()) return;
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
    <AppPage fill flush>
      <div className="huddle flex h-full min-h-0 flex-col gap-4 md:mx-auto md:w-full md:max-w-4xl md:px-6 md:pb-6">
        {/* Feed / Drafts tabs + actions */}
        <div className="huddle-actions flex shrink-0 items-center gap-2 px-4 md:px-0">
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
                    feedView === 'chat' ? 'Card view (comments & likes)' : 'Chat view (rich thread)'
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
            className="shrink-0 mx-4 md:mx-0"
            autoFocus
          />
        )}

        {/* Drafts tab — private, multiple drafts */}
        {selectedTeamId && feedTab === 'drafts' && user && (
          <div className="px-4 md:px-0">
            <DraftsPanel
              teamId={selectedTeamId}
              userInitials={getUserInitials(user.name)}
              userColor={getUserColor(user.id)}
            />
          </div>
        )}

        {/* Composer stays put while the feed below it scrolls.
            On a short viewport the expanded composer is taller than the space
            between the header and the fixed bottom nav, so it must be able to
            shrink and scroll its own overflow — otherwise its lower half (the
            attach buttons, Cancel and Post) is clipped under the nav and
            unreachable. min-h-0 is what lets a flex child shrink below its
            content height. */}
        {selectedTeamId && feedTab === 'feed' && (
          <div className="huddle-composer min-h-0 max-h-[70vh] overflow-y-auto overscroll-contain">
            <HuddleComposer
              key={selectedTeamId}
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
                      highlighted={post.id === highlightedPostId}
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
