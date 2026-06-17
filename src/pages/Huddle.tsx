import { useState, useEffect } from 'react';
import { HuddleComposer } from '../features/huddle/HuddleComposer';
import { PostCard } from '../features/huddle/PostCard';
import type { ComposerContent } from '../features/huddle/types';
import { useSession } from '@lib/useSession';
import { useTeam } from '@lib/TeamContext';
import { huddleApi, teamApi, type HuddlePost, type Team } from '@lib/api';

function getUserInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

function getUserColor(userId: string): 'indigo' | 'teal' | 'coral' | 'amber' | 'pink' | 'green' {
  const colors: Array<'indigo' | 'teal' | 'coral' | 'amber' | 'pink' | 'green'> = ['indigo', 'teal', 'coral', 'amber', 'pink', 'green'];
  const hash = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}





export default function Huddle() {
  const [posts, setPosts] = useState<HuddlePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [team, setTeam] = useState<Team | null>(null);
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
        const teams = await teamApi.getTeams();
        const foundTeam = teams.find(t => t.id === selectedTeamId);
        setTeam(foundTeam || null);
      } catch (err) {
        console.error('[Huddle] Failed to load team:', err);
      }
    }

    loadTeam();
  }, [selectedTeamId]);

  // Load posts on mount or when team changes
  useEffect(() => {
    async function loadPosts() {
      if (!selectedTeamId) {
        setPosts([]);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const apiPosts = await huddleApi.getPosts(selectedTeamId);
        setPosts(apiPosts);
      } catch (err) {
        console.error('[Huddle] Failed to load posts:', err);
        setError('Failed to load posts');
        setPosts([]);
      } finally {
        setLoading(false);
      }
    }

    loadPosts();
  }, [selectedTeamId]);

  // WebSocket for real-time updates
  useEffect(() => {
    if (!selectedTeamId) return;

    const ws = huddleApi.openLiveStream(selectedTeamId);

    ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string);
        
        if (data.type === 'snapshot') {
          // Initial snapshot - replace all posts
          console.log('[Huddle] Received snapshot:', data.posts.length, 'posts');
          if (data.posts.length > 0) {
            console.log('[Huddle] First post sample:', data.posts[0]);
          }
          setPosts(data.posts);
        } else if (data.type === 'create') {
          // New post created or updated
          console.log('[Huddle] Received create event:', data.post);
          setPosts(prev => {
            const existing = prev.findIndex(p => p.id === data.post.id);
            if (existing >= 0) {
              // Update existing post
              const updated = [...prev];
              updated[existing] = data.post;
              return updated;
            }
            // Add new post
            return [data.post, ...prev];
          });
        } else if (data.type === 'delete') {
          // Post deleted
          setPosts(prev => prev.filter(p => p.id !== data.postId));
        }
      } catch (err) {
        console.error('[Huddle] WebSocket message error:', err);
      }
    };

    return () => {
      ws.close();
    };
  }, [selectedTeamId]);

  async function addPost(content: ComposerContent) {
    try {
      if (!user || !selectedTeamId) {
        alert('Please select a team first');
        return;
      }
    
      // Prepare attachments for API
      const attachments = content.attachments.map(att => {
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
      const mentionUserIds = (content.mentions || []).map(m => m.userId);

      // Call API to create post
      await huddleApi.createPost({
        teamId: selectedTeamId,
        content: {
          text: content.text,
          mentions: mentionUserIds,
        },
        ticketId: content.ticketId,
        attachments,
      });

      // WebSocket will add the post to the feed automatically
    } catch (error) {
      console.error('[Huddle] Error in addPost:', error);
      alert('Failed to create post. Please try again.');
    }
  }

  async function handlePostUpdated() {
    // Reload posts after update/delete
    if (selectedTeamId) {
      try {
        const apiPosts = await huddleApi.getPosts(selectedTeamId);
        setPosts(apiPosts);
      } catch (err) {
        console.error('[Huddle] Failed to reload posts:', err);
      }
    }
  }

  // Determine permissions for each post
  function canEditPost(post: HuddlePost): boolean {
    if (!user || !team) return false;
    const isAuthor = post.userId === user.id;
    const isTeamAdmin = team.admins.includes(user.id);
    const isOrgOwner = user.organizationMembership?.role === 'owner' && 
                       user.organizationMembership?.organizationId === team.orgId;
    return isAuthor || isTeamAdmin || isOrgOwner;
  }

  function canDeletePost(post: HuddlePost): boolean {
    // Same permissions as edit
    return canEditPost(post);
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-neutral-900 min-h-screen">
      {/* Header - Now sticky */}
      <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3 bg-white dark:bg-neutral-800 border-b border-gray-100 dark:border-neutral-700 shrink-0">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-neutral-100 tracking-tight">Huddle</h1>
        <div className="flex gap-2">
          <button className="w-8 h-8 rounded-full bg-gray-100 dark:bg-neutral-700 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-neutral-600 transition-colors">
            <svg className="w-4 h-4 text-gray-500 dark:text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
          <button className="w-8 h-8 rounded-full bg-gray-100 dark:bg-neutral-700 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-neutral-600 transition-colors">
            <svg className="w-4 h-4 text-gray-500 dark:text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          </button>
        </div>
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto">
        {!selectedTeamId && (
          <div className="flex items-center justify-center py-16 px-4">
            <p className="text-sm text-gray-500 dark:text-neutral-400">Please select a team to view the huddle feed</p>
          </div>
        )}

        {selectedTeamId && (
          <>
            <HuddleComposer 
              onPost={addPost}
              userInitials={user ? getUserInitials(user.name) : 'U'}
              userColor={user ? getUserColor(user.id) : 'indigo'}
            />
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
                <p className="text-sm text-gray-500 dark:text-neutral-400">No posts yet. Be the first to share!</p>
              </div>
            )}

            {!loading && !error && user && posts.map(post => (
              <PostCard 
                key={post.id} 
                post={post}
                canEdit={canEditPost(post)}
                canDelete={canDeletePost(post)}
                onPostUpdated={handlePostUpdated}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
