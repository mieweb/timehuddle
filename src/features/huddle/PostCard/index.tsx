import { useState, useRef, useEffect } from 'react';
import type { HuddlePost } from '@lib/api';
import { huddleApi } from '@lib/api';

// ── Avatar Component ──────────────────────────────────────────────────────────

type AvatarColor = 'indigo' | 'teal' | 'coral' | 'amber' | 'pink' | 'green';

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

function getUserColor(userId: string): AvatarColor {
  const colors: AvatarColor[] = ['indigo', 'teal', 'coral', 'amber', 'pink', 'green'];
  const hash = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

// ── PostCard Component ────────────────────────────────────────────────────────

interface PostCardProps {
  post: HuddlePost;
  currentUser: {
    id: string;
    name: string;
    initials: string;
  };
  onPostUpdated?: () => void;
}

export function PostCard({ post, currentUser: _currentUser, onPostUpdated }: PostCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(post.content.text);
  const [showMenu, setShowMenu] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    }
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showMenu]);

  const handleEdit = () => {
    setIsEditing(true);
    setShowMenu(false);
  };

  const handleSaveEdit = async () => {
    try {
      await huddleApi.updatePost(post.id, {
        content: {
          text: editContent,
          mentions: post.content.mentions, // Keep existing mentions for now
        },
      });
      setIsEditing(false);
      onPostUpdated?.();
    } catch (error) {
      console.error('[PostCard] Failed to update post:', error);
      alert('Failed to update post');
    }
  };

  const handleCancelEdit = () => {
    setEditContent(post.content.text);
    setIsEditing(false);
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this post?')) {
      return;
    }
    setIsDeleting(true);
    try {
      await huddleApi.deletePost(post.id);
      onPostUpdated?.();
    } catch (error) {
      console.error('[PostCard] Failed to delete post:', error);
      alert('Failed to delete post');
      setIsDeleting(false);
    }
  };

  const handleTicketClick = () => {
    if (post.ticketId) {
      window.location.href = `/app/tickets/${post.ticketId}`;
    }
  };
  const formatTimestamp = (date: string) => {
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString();
  };

  if (isDeleting) {
    return null; // Hide the post while deleting
  }

  const authorName = post.author?.name || 'Unknown User';
  const authorInitials = post.author?.initials || 'U';
  const avatarColor = getUserColor(post.userId);

  return (
    <div className="border-b border-gray-100 dark:border-neutral-700 px-5 pt-4 bg-white dark:bg-neutral-800">
      {/* Author Header */}
      <div className="flex items-center gap-2.5 mb-3">
        <Avatar initials={authorInitials} color={avatarColor} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm text-gray-900 dark:text-white">
                {authorName}
              </span>
              <span className="text-xs text-gray-500 dark:text-neutral-400">
                {formatTimestamp(post.createdAt)}
              </span>
            </div>
            {post.ticket && (
              <Badge 
                variant="secondary" 
                size="sm" 
                className="mt-1 cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-900/30"
                onClick={handleTicketClick}
              >
                #{post.ticket.number} — {post.ticket.title}
              </Badge>
            )}
          </div>
        {/* Three-dot menu */}
        {(post.canEdit || post.canDelete) && (
          <div className="relative" ref={menuRef}>
            <button
              className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors"
              onClick={() => setShowMenu(!showMenu)}
            >
              <svg className="w-4 h-4 text-gray-400 dark:text-neutral-500" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
              </svg>
            </button>
            
            {showMenu && (
              <div className="absolute right-0 mt-1 w-48 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-gray-200 dark:border-neutral-700 z-10">
                {post.canEdit && (
                  <button
                    className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-neutral-200 hover:bg-gray-100 dark:hover:bg-neutral-700 rounded-t-lg"
                    onClick={handleEdit}
                  >
                    Edit post
                  </button>
                )}
                {post.canDelete && (
                  <button
                    className="w-full px-4 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-neutral-700 rounded-b-lg"
                    onClick={handleDelete}
                  >
                    Delete post
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        )}
        </div>

      {/* Ticket Badge */}
      {post.ticket && (
        <div 
          className="inline-flex items-center gap-1.5 px-2.5 py-1 mb-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-lg cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
          onClick={handleTicketClick}
        >
          <div className="w-3.5 h-3.5 rounded bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center shrink-0">
            <svg className="w-2 h-2 text-amber-500 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
            </svg>
          </div>
          <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
            #{post.ticket.number} — {post.ticket.title}
          </span>
        </div>
      )}

      {/* Post Content */}
      {isEditing ? (
        <div className="mb-3">
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full min-h-[100px] p-3 text-sm border border-gray-200 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-neutral-500 outline-none focus:border-indigo-400 dark:focus:border-indigo-500 transition-colors"
            placeholder="Write your post..."
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleSaveEdit}
              className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-500 rounded-lg hover:bg-indigo-600 transition-colors"
            >
              Save
            </button>
            <button
              onClick={handleCancelEdit}
              className="px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-neutral-300 bg-gray-100 dark:bg-neutral-700 rounded-lg hover:bg-gray-200 dark:hover:bg-neutral-600 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-700 dark:text-neutral-300 leading-relaxed mb-3">{post.content.text}</p>
      )}

        {/* Attachments */}
        {post.attachments && post.attachments.length > 0 && (
          <div className="mb-3 grid grid-cols-2 gap-2">
            {post.attachments.map((attachment) => (
              <div key={attachment.mediaId} className="relative rounded-lg overflow-hidden">
                {attachment.type === 'video' && attachment.thumbnailUrl && (
                  <img
                    src={attachment.thumbnailUrl}
                    alt={attachment.filename || 'Video thumbnail'}
                    className="w-full h-auto"
                  />
                )}
      {/* Actions */}
      <div className="flex items-center gap-0.5 py-2 border-t border-gray-100 dark:border-neutral-700 -mx-1">
        <button className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-neutral-500 hover:text-gray-600 dark:hover:text-neutral-400 px-2.5 py-2 rounded-lg transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
          </svg>
          {post.likes?.length || 0}
        </button>

        <div className="w-px h-4 bg-gray-200 dark:bg-neutral-700 mx-1" />

        <button className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-neutral-500 hover:text-gray-600 dark:hover:text-neutral-400 px-2.5 py-2 rounded-lg transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          0
        </button>
      </div>
    </div    </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-2 border-t border-gray-200 dark:border-neutral-700">
          <Button variant="ghost" size="sm">
            <span className="text-xs">
              {post.likes?.length || 0} {post.likes?.length === 1 ? 'Like' : 'Likes'}
            </span>
          </Button>
          <Button variant="ghost" size="sm">
            <span className="text-xs">
              0 Comments
            </span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
