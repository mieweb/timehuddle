import { useState, useRef, useEffect } from 'react';
import type { HuddlePost } from '@lib/api';
import { huddleApi, METEOR_BASE_URL } from '@lib/api';
import { MarkdownContent } from '../MarkdownContent';
import { HuddleComments } from '../HuddleComments';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';

// ── URL Resolution ────────────────────────────────────────────────────────────
function resolveAttachmentUrl(url: string | undefined): string {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return `${METEOR_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}

// ── Avatar ────────────────────────────────────────────────────────────────────
type AvatarColor = 'indigo' | 'teal' | 'coral' | 'amber' | 'pink' | 'green';

const avatarClasses: Record<AvatarColor, string> = {
  indigo: 'bg-indigo-100 text-indigo-600',
  teal: 'bg-teal-100 text-teal-600',
  coral: 'bg-red-100 text-red-500',
  amber: 'bg-amber-100 text-amber-600',
  pink: 'bg-pink-100 text-pink-500',
  green: 'bg-green-100 text-green-600',
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
    <div
      className={`${sz} rounded-full flex items-center justify-center font-semibold shrink-0 ${avatarClasses[color]}`}
    >
      {initials}
    </div>
  );
}

function getUserColor(userId: string): AvatarColor {
  const colors: AvatarColor[] = ['indigo', 'teal', 'coral', 'amber', 'pink', 'green'];
  const hash = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

function getUserInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.substring(0, 2).toUpperCase();
}

// ── PostCard ──────────────────────────────────────────────────────────────────
interface PostCardProps {
  post: HuddlePost;
  currentUserId: string;
  canEdit: boolean;
  canDelete: boolean;
  onPostUpdated?: () => void;
}

export function PostCard({
  post,
  currentUserId,
  canEdit,
  canDelete,
  onPostUpdated,
}: PostCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(post.content.text);
  const [editTab, setEditTab] = useState<'write' | 'preview'>('write');
  const [showMenu, setShowMenu] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [likeCount, setLikeCount] = useState(post.likes?.length ?? 0);
  const [hasLiked, setHasLiked] = useState(post.likes?.includes(currentUserId) ?? false);
  const [commentCount, setCommentCount] = useState(post.commentCount ?? 0);
  const menuRef = useRef<HTMLDivElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

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

  // Reset edit state and update counts when post changes
  useEffect(() => {
    setEditContent(post.content.text);
    setLikeCount(post.likes?.length ?? 0);
    setHasLiked(post.likes?.includes(currentUserId) ?? false);
    setCommentCount(post.commentCount ?? 0);
  }, [post, currentUserId]);

  const handleEdit = () => {
    setIsEditing(true);
    setEditTab('write');
    setShowMenu(false);
  };

  const handleSaveEdit = async () => {
    try {
      await huddleApi.updatePost(post.id, { text: editContent, mentions: post.content.mentions });
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
    if (!confirm('Are you sure you want to delete this post?')) return;
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
    if (post.ticketId) window.location.href = `/app/tickets/${post.ticketId}`;
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

  if (isDeleting) return null;

  const authorName = (post as any).userName || 'Unknown User';
  const authorInitials = (post as any).userInitials || getUserInitials(authorName);
  const avatarColor = getUserColor(post.userId);

  return (
    <div className="border-b border-gray-100 dark:border-neutral-700 px-5 pt-4 bg-white dark:bg-neutral-800">
      {/* ── Author header ── */}
      <div className="flex items-center gap-2.5 mb-3">
        <Avatar initials={authorInitials} color={avatarColor} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-gray-900 dark:text-white">{authorName}</span>
            <span className="text-xs text-gray-500 dark:text-neutral-400">
              {formatTimestamp(post.createdAt)}
            </span>
            {post.updatedAt && post.updatedAt !== post.createdAt && (
              <span className="text-xs text-gray-400 dark:text-neutral-500 italic">edited</span>
            )}
          </div>
        </div>

        {/* Three-dot menu */}
        {(canEdit || canDelete) && (
          <div className="relative" ref={menuRef}>
            <button
              className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors"
              onClick={() => setShowMenu(!showMenu)}
            >
              <svg
                className="w-4 h-4 text-gray-400 dark:text-neutral-500"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <circle cx="12" cy="5" r="1.5" />
                <circle cx="12" cy="12" r="1.5" />
                <circle cx="12" cy="19" r="1.5" />
              </svg>
            </button>
            {showMenu && (
              <div className="absolute right-0 mt-1 w-48 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-gray-200 dark:border-neutral-700 z-10">
                {canEdit && (
                  <button
                    className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-neutral-200 hover:bg-gray-100 dark:hover:bg-neutral-700 rounded-t-lg"
                    onClick={handleEdit}
                  >
                    Edit post
                  </button>
                )}
                {canDelete && (
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
      </div>

      {/* ── Ticket badge ── */}
      {post.ticketId && (
        <div
          className="inline-flex items-center gap-1.5 px-2.5 py-1 mb-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-lg cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
          onClick={handleTicketClick}
        >
          <div className="w-3.5 h-3.5 rounded bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center shrink-0">
            <svg
              className="w-2 h-2 text-amber-500 dark:text-amber-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"
              />
            </svg>
          </div>
          <span className="text-xs font-medium text-amber-700 dark:text-amber-300 truncate">
            {post.ticketTitle || 'Linked Ticket'}
          </span>
        </div>
      )}

      {/* ── Post content ── */}
      {isEditing ? (
        <div className="mb-3">
          {/* Edit write/preview tabs */}
          <div className="flex gap-1 border-b border-gray-100 dark:border-neutral-700 mb-0">
            {(['write', 'preview'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setEditTab(t)}
                className={`text-xs px-3 pb-2 pt-1 font-medium transition-colors border-b-2 -mb-px capitalize ${
                  editTab === t
                    ? 'text-indigo-500 border-indigo-500'
                    : 'text-gray-400 dark:text-neutral-500 border-transparent hover:text-gray-600 dark:hover:text-neutral-300'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {editTab === 'write' ? (
            <textarea
              ref={editTextareaRef}
              autoFocus
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full min-h-24 p-3 mt-2 text-sm font-mono border border-gray-200 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-neutral-500 outline-none focus:border-indigo-400 dark:focus:border-indigo-500 transition-colors resize-none leading-relaxed"
              placeholder="Write your post... (markdown supported)"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleSaveEdit();
                }
              }}
            />
          ) : (
            <div className="mt-2 min-h-24 border border-gray-200 dark:border-neutral-700 rounded-lg px-3 py-2.5">
              {editContent.trim() ? (
                <MarkdownContent content={editContent} />
              ) : (
                <span className="text-gray-300 dark:text-neutral-600 text-sm">
                  Nothing to preview...
                </span>
              )}
            </div>
          )}

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
            <span className="text-xs text-gray-300 dark:text-neutral-600 self-center ml-1 hidden sm:block">
              ⌘↵ to save
            </span>
          </div>
        </div>
      ) : (
        // ── Render markdown instead of plain text ──
        <div className="mb-3">
          <MarkdownContent content={post.content.text} />
        </div>
      )}

      {/* ── Attachments ── */}
      {post.attachments && post.attachments.length > 0 && (
        <div className={`mb-3 ${post.attachments.length === 1 ? '' : 'grid grid-cols-2'} gap-2`}>
          {post.attachments.map((attachment) => (
            <div key={attachment.mediaId} className="relative rounded-xl overflow-hidden">
              {attachment.type === 'image' && (
                <div className="relative w-full bg-gray-100 dark:bg-neutral-800 rounded-xl max-h-[500px] flex items-center justify-center">
                  <img
                    src={resolveAttachmentUrl(attachment.url)}
                    alt={attachment.filename || 'Image'}
                    className="max-w-full max-h-[500px] object-contain rounded-xl"
                  />
                </div>
              )}
              {attachment.type === 'video' && (
                <div className="relative w-full rounded-xl overflow-hidden bg-black">
                  <video
                    controls
                    className="w-full rounded-xl max-h-96"
                    src={resolveAttachmentUrl(attachment.url)}
                    poster={
                      attachment.thumbnailUrl
                        ? resolveAttachmentUrl(attachment.thumbnailUrl)
                        : undefined
                    }
                  >
                    Your browser does not support the video tag.
                  </video>
                </div>
              )}
              {attachment.type === 'file' && (
                <a
                  href={resolveAttachmentUrl(attachment.url)}
                  download={attachment.filename}
                  className="block bg-neutral-100 dark:bg-neutral-700 p-4 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-600 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <svg
                      className="w-8 h-8 text-gray-500 dark:text-neutral-400 shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {attachment.filename || 'Document'}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-neutral-400">
                        Click to download
                      </p>
                    </div>
                  </div>
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Actions ── */}
      <div className="flex items-center gap-0.5 py-2 border-t border-gray-100 dark:border-neutral-700 -mx-1">
        <button
          onClick={async () => {
            try {
              // Optimistic update
              const previousLiked = hasLiked;
              const previousCount = likeCount;
              setHasLiked(!previousLiked);
              setLikeCount(previousLiked ? previousCount - 1 : previousCount + 1);

              // Call API (WebSocket will broadcast update to other clients)
              await huddleApi.toggleLike(post.id);
              // Don't set count from response - let WebSocket update handle it
            } catch (error) {
              console.error('[PostCard] Failed to toggle like:', error);
              // Revert optimistic update on error
              setHasLiked(hasLiked);
              setLikeCount(likeCount);
            }
          }}
          className={`flex items-center gap-1.5 text-xs px-2.5 py-2 rounded-lg transition-colors ${
            hasLiked
              ? 'text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300'
              : 'text-gray-400 dark:text-neutral-500 hover:text-gray-600 dark:hover:text-neutral-400'
          }`}
        >
          <svg
            className="w-4 h-4"
            fill={hasLiked ? 'currentColor' : 'none'}
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
            />
          </svg>
          {likeCount}
        </button>
        <div className="w-px h-4 bg-gray-200 dark:bg-neutral-700 mx-1" />
        <button
          onClick={() => setShowComments(!showComments)}
          className={`flex items-center gap-1.5 text-xs px-2.5 py-2 rounded-lg transition-colors ${
            showComments
              ? 'text-indigo-500 dark:text-indigo-400'
              : 'text-gray-400 dark:text-neutral-500 hover:text-gray-600 dark:hover:text-neutral-400'
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          {commentCount}
        </button>
        <div className="w-px h-4 bg-gray-200 dark:bg-neutral-700 mx-1" />
        <button
          onClick={async () => {
            const postUrl = `${window.location.origin}/app/huddle?postId=${post.id}`;
            try {
              // Use Capacitor Share plugin on native platforms
              if (Capacitor.isNativePlatform()) {
                await Share.share({
                  title: `${authorName}'s post`,
                  text:
                    post.content.text.length > 200
                      ? post.content.text.substring(0, 197) + '...'
                      : post.content.text,
                  url: postUrl,
                  dialogTitle: 'Share post',
                });
              } else if (navigator.share) {
                // Use Web Share API on web
                await navigator.share({
                  title: `${authorName}'s post`,
                  text:
                    post.content.text.length > 200
                      ? post.content.text.substring(0, 197) + '...'
                      : post.content.text,
                  url: postUrl,
                });
              } else {
                // Fallback: copy to clipboard
                await navigator.clipboard.writeText(postUrl);
                alert('Link copied to clipboard!');
              }
            } catch (error) {
              if ((error as Error).name !== 'AbortError') {
                console.error('[PostCard] Failed to share:', error);
              }
            }
          }}
          className="flex items-center gap-1.5 text-xs px-2.5 py-2 rounded-lg transition-colors text-gray-400 dark:text-neutral-500 hover:text-gray-600 dark:hover:text-neutral-400"
          title="Share post"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
            />
          </svg>
          Share
        </button>
      </div>

      {/* ── Comments section ── */}
      {showComments && (
        <HuddleComments
          postId={post.id}
          currentUserId={currentUserId}
          canDelete={canDelete}
          onCommentAdded={() => {
            setCommentCount(commentCount + 1);
            onPostUpdated?.();
          }}
          onCommentDeleted={() => {
            setCommentCount(commentCount - 1);
            onPostUpdated?.();
          }}
        />
      )}
    </div>
  );
}
