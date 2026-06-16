import { useState, useEffect } from 'react';
import { HuddleComposer } from '../features/huddle/HuddleComposer';
import type { ComposerContent } from '../features/huddle/types';
import { useSession } from '@lib/useSession';
import { useTeam } from '@lib/TeamContext';
import { huddleApi, type HuddlePost as ApiHuddlePost } from '@lib/api';

// ── User Helpers ──────────────────────────────────────────────────────────────

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

// ── Types ────────────────────────────────────────────────────────────────────

interface Ticket {
  id: string; // Changed from number to match API
  title: string;
  status: 'Open' | 'In progress';
  time: string;
  assignee: string;
}

interface Comment {
  id: string;
  author: string;
  initials: string;
  text: string;
  time: string;
  avatarColor: AvatarColor;
}

interface Post {
  id: string;
  author: string;
  initials: string;
  avatarColor: AvatarColor;
  time: string;
  body: string;
  imageUrl?: string;
  videoFile?: string;
  videoTicketId?: number;
  ticket?: Ticket;
  likes: number;
  comments: Comment[];
  views: number;
}

type AvatarColor = 'indigo' | 'teal' | 'coral' | 'amber' | 'pink' | 'green';

// ── Avatar ───────────────────────────────────────────────────────────────────

const avatarClasses: Record<AvatarColor, string> = {
  indigo: 'bg-indigo-100 text-indigo-600',
  teal:   'bg-teal-100 text-teal-600',
  coral:  'bg-red-100 text-red-500',
  amber:  'bg-amber-100 text-amber-600',
  pink:   'bg-pink-100 text-pink-500',
  green:  'bg-green-100 text-green-600',
};

function Avatar({
  initials,
  color,
  size = 'md',
}: {
  initials: string;
  color: AvatarColor;
  size?: 'sm' | 'md';
}) {
  const sz = size === 'sm' ? 'w-7 h-7 text-[10px]' : 'w-9 h-9 text-[13px]';
  return (
    <div className={`${sz} rounded-full flex items-center justify-center font-semibold shrink-0 ${avatarClasses[color]}`}>
      {initials}
    </div>
  );
}

// ── Ticket embed ──────────────────────────────────────────────────────────────

function TicketEmbed({ ticket }: { ticket: Ticket }) {
  return (
    <div className="border border-amber-200 dark:border-amber-800/50 rounded-xl overflow-hidden mb-3">
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-100 dark:border-amber-800/50">
        <div className="w-5 h-5 rounded-md bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center shrink-0">
          <svg className="w-3 h-3 text-amber-500 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
          </svg>
        </div>
        <span className="text-xs font-medium flex-1 text-gray-800 dark:text-neutral-200">{ticket.title}</span>
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-300">
          {ticket.status}
        </span>
      </div>
      <div className="flex items-center gap-4 px-3 py-2 bg-white dark:bg-neutral-800">
        <span className="text-xs text-gray-400 dark:text-neutral-500 flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {ticket.time}
        </span>
        <span className="text-xs text-gray-400 dark:text-neutral-500 flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          {ticket.assignee}
        </span>
        <button className="ml-auto text-xs text-indigo-500 dark:text-indigo-400 flex items-center gap-1 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors">
          Open
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── Video thumbnail ───────────────────────────────────────────────────────────

function VideoThumb({ filename, ticketId }: { filename: string; ticketId?: number }) {
  return (
    <div className="relative bg-gray-100 dark:bg-neutral-800 rounded-xl h-48 flex items-center justify-center mb-3 overflow-hidden cursor-pointer group border border-gray-200 dark:border-neutral-700">
      <svg className="w-8 h-8 text-gray-300 dark:text-neutral-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center bg-black/5 dark:bg-black/20 group-hover:bg-black/10 dark:group-hover:bg-black/30 transition-colors">
        <div className="w-12 h-12 rounded-full bg-white dark:bg-neutral-700 shadow-md flex items-center justify-center">
          <svg className="w-5 h-5 text-gray-700 dark:text-neutral-300 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      </div>
      <div className="absolute bottom-2.5 left-3 text-[10px] text-gray-100 dark:text-neutral-200 bg-gray-800/70 dark:bg-neutral-900/70 px-2 py-1 rounded">
        {filename}
      </div>
      {ticketId && (
        <div className="absolute top-2.5 right-3 text-[10px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 px-2 py-1 rounded">
          ticket #{ticketId}
        </div>
      )}
    </div>
  );
}

// ── Post card ─────────────────────────────────────────────────────────────────

function PostCard({ post }: { post: Post }) {
  const [liked, setLiked]         = useState(false);
  const [likeCount, setLikeCount] = useState(post.likes);
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText]   = useState('');
  const [comments, setComments]         = useState<Comment[]>(post.comments);

  function handleLike() {
    setLiked(prev => !prev);
    setLikeCount(prev => liked ? prev - 1 : prev + 1);
  }

  function sendComment() {
    if (!commentText.trim()) return;
    setComments(prev => [
      ...prev,
      {
        id: Date.now().toString(),
        author: 'You',
        initials: 'PD',
        text: commentText.trim(),
        time: 'Just now',
        avatarColor: 'indigo',
      },
    ]);
    setCommentText('');
  }

  return (
    <div className="border-b border-gray-100 dark:border-neutral-700 px-5 pt-4 bg-white dark:bg-neutral-800">
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-3">
        <Avatar initials={post.initials} color={post.avatarColor} />
        <div className="flex-1">
          <div className="text-sm font-semibold text-gray-800 dark:text-neutral-200">{post.author}</div>
          <div className="text-xs text-gray-400 dark:text-neutral-500">{post.time}</div>
        </div>
        <button className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors">
          <svg className="w-4 h-4 text-gray-400 dark:text-neutral-500" fill="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
          </svg>
        </button>
      </div>

      {/* Image */}
      {post.imageUrl && (
        <div className="mb-3 -mx-5 px-5">
          <img
            src={post.imageUrl}
            alt="Post attachment"
            className="w-full rounded-lg border border-gray-200 dark:border-neutral-700"
          />
        </div>
      )}

      {/* Video */}
      {post.videoFile && (
        <VideoThumb filename={post.videoFile} ticketId={post.videoTicketId} />
      )}

      {/* Body text */}
      <p className="text-sm text-gray-700 dark:text-neutral-300 leading-relaxed mb-3">{post.body}</p>

      {/* Ticket */}
      {post.ticket && <TicketEmbed ticket={post.ticket} />}

      {/* Actions */}
      <div className="flex items-center gap-0.5 py-2 border-t border-gray-100 dark:border-neutral-700 -mx-1">
        <button
          onClick={handleLike}
          className={`flex items-center gap-1.5 text-xs px-2.5 py-2 rounded-lg transition-colors ${
            liked ? 'text-pink-500 dark:text-pink-400' : 'text-gray-400 dark:text-neutral-500 hover:text-gray-600 dark:hover:text-neutral-400'
          }`}
        >
          <svg className="w-4 h-4" fill={liked ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
          </svg>
          {likeCount}
        </button>

        <div className="w-px h-4 bg-gray-200 dark:bg-neutral-700 mx-1" />

        <button
          onClick={() => setShowComments(v => !v)}
          className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-neutral-500 hover:text-gray-600 dark:hover:text-neutral-400 px-2.5 py-2 rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          {comments.length}
        </button>

        <div className="w-px h-4 bg-gray-200 dark:bg-neutral-700 mx-1" />

        <button className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-neutral-500 hover:text-gray-600 dark:hover:text-neutral-400 px-2.5 py-2 rounded-lg transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
        </button>

        <div className="ml-auto flex items-center gap-1 text-xs text-gray-300 dark:text-neutral-600">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          {post.views}
        </div>
      </div>

      {/* Comments section */}
      {showComments && (
        <div className="pb-3 bg-gray-50 dark:bg-neutral-900 -mx-5 px-5 pt-3 border-t border-gray-100 dark:border-neutral-700">
          {comments.map(c => (
            <div key={c.id} className="flex gap-2 mb-2.5">
              <Avatar initials={c.initials} color={c.avatarColor} size="sm" />
              <div className="flex-1 bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-t-none rounded-xl px-3 py-2">
                <div className="text-xs font-semibold text-gray-700 dark:text-neutral-300 mb-0.5">{c.author}</div>
                <div className="text-xs text-gray-500 dark:text-neutral-400 leading-relaxed">{c.text}</div>
                <div className="text-[10px] text-gray-300 dark:text-neutral-600 mt-1">{c.time}</div>
              </div>
            </div>
          ))}
          <div className="flex items-center gap-2 mt-3">
            <Avatar initials="PD" color="indigo" size="sm" />
            <input
              className="flex-1 bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-full px-4 py-2 text-xs text-gray-700 dark:text-neutral-300 placeholder:text-gray-300 dark:placeholder:text-neutral-600 outline-none focus:border-indigo-400 dark:focus:border-indigo-500 transition-colors"
              placeholder="Reply..."
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendComment()}
            />
            <button
              onClick={sendComment}
              className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center hover:bg-indigo-600 transition-colors shrink-0"
            >
              <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function Huddle() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useSession();
  const { selectedTeamId } = useTeam();

  // Convert API post to display format
  const toDisplayPost = (p: ApiHuddlePost): Post => ({
    id: p.id,
    author: 'User', // TODO: Fetch user names
    initials: 'U',
    avatarColor: getUserColor(p.userId),
    time: new Date(p.createdAt).toLocaleString(),
    body: p.content.text,
    imageUrl: p.attachments[0]?.type === 'image' ? p.attachments[0].url : undefined,
    ticket: p.ticketId ? {
      id: p.ticketId,
      title: `#${p.ticketId} — Ticket`,
      status: 'Open',
      time: '0m',
      assignee: 'User',
    } : undefined,
    likes: 0,
    views: 0,
    comments: [],
  });

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
        const displayPosts = apiPosts.map(toDisplayPost);
        setPosts(displayPosts);
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
          const displayPosts = data.posts.map(toDisplayPost);
          setPosts(displayPosts);
        } else if (data.type === 'create') {
          // New post created
          const newPost = toDisplayPost(data.post);
          setPosts(prev => [newPost, ...prev]);
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
      console.log('[Huddle] addPost called');
      console.log('[Huddle] New post content:', content);
      console.log('[Huddle] Attachments received:', content.attachments);
    
      if (!user || !selectedTeamId) {
        alert('Please select a team first');
        return;
      }
    
      // Prepare attachments for API
      const attachments = content.attachments.map(att => ({
        mediaId: att.id,
        type: (att.type || (att.mimeType?.startsWith('image/') ? 'image' : 'file')) as 'image' | 'video' | 'file',
        url: att.url,
        filename: att.filename,
      }));

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
      console.log('[Huddle] Post created successfully, waiting for WebSocket update');
    } catch (error) {
      console.error('[Huddle] Error in addPost:', error);
      alert('Failed to create post. Please try again.');
    }
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-neutral-900 min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-white dark:bg-neutral-800 border-b border-gray-100 dark:border-neutral-700 shrink-0">
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

            {!loading && !error && posts.map(post => (
              <PostCard key={post.id} post={post} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
