import { useCallback, useEffect, useRef, useState } from 'react';
import { huddleApi, type HuddlePost } from '@lib/api';
import { getDdpClient } from '@lib/ddp';
import { useRefresh } from '@lib/RefreshContext';

/**
 * A team's published Huddle posts, newest first, kept live over the
 * `huddlePosts.byTeam` DDP publication with a REST snapshot overlaid for when
 * the socket is down. `authorId` narrows the feed to one person's posts (their
 * profile feed). Also wires pull-to-refresh to the REST refetch.
 */
export function useHuddlePosts({ teamId, authorId }: { teamId: string | null; authorId?: string }) {
  const [posts, setPosts] = useState<HuddlePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Last REST snapshot for the team, replaced wholesale on every refetch (not
  // merged) so an edit or delete that happened while DDP was disconnected is
  // reflected, and a post absent from a later snapshot doesn't linger forever.
  const restPostsRef = useRef<Map<string, HuddlePost>>(new Map());

  // Build the feed from the DDP cache plus any pending overlay posts. Exposed
  // through `refresh` so a caller can trigger an immediate re-sync after posting.
  const syncPosts = useCallback(() => {
    if (!teamId) return;
    const ddp = getDdpClient();
    const byId = new Map<string, HuddlePost>();
    for (const p of ddp.docs('huddlePosts')) {
      if (p.teamId !== teamId) continue;
      // The DDP cache is shared: other screens (the dashboard) keep the whole
      // team's feed subscribed, so the author filter has to hold here too.
      if (authorId && p.userId !== authorId) continue;
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
  }, [teamId, authorId]);

  // Fetch the feed over REST and overlay it. Used by pull-to-refresh and as a
  // fallback when the live DDP socket is down (dropped while backgrounded for a
  // Pulse recording), so the feed still updates without a reconnect.
  const refreshFeed = useCallback(async () => {
    if (!teamId) return;
    try {
      const fresh = await huddleApi.getPosts(teamId, authorId);
      restPostsRef.current = new Map(fresh.map((post) => [post.id, post]));
      syncPosts();
    } catch (err) {
      console.error('[Huddle] refreshFeed failed:', err);
    }
  }, [teamId, authorId, syncPosts]);

  // Wire pull-to-refresh (swipe down) to the REST refetch.
  useRefresh(refreshFeed);

  // Subscribe to live DDP publication for huddle posts
  useEffect(() => {
    if (!teamId) {
      setPosts([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const ddp = getDdpClient();
    const unsub = ddp.subscribe(
      'huddlePosts.byTeam',
      authorId ? [teamId, authorId] : [teamId],
      () => setLoading(false),
    );

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
  }, [teamId, authorId, syncPosts, refreshFeed]);

  // Whether a post has reached the feed by *either* route — the REST overlay or
  // the DDP cache.
  const isInFeed = useCallback(
    (id: string) =>
      restPostsRef.current.has(id) ||
      getDdpClient()
        .docs('huddlePosts')
        .some((p) => (p.id ?? p._id) === id),
    [],
  );

  return { posts, loading, error, refresh: refreshFeed, isInFeed };
}
