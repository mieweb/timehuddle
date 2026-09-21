import { useState, useEffect, useRef } from 'react';
import { Textarea } from '@mieweb/ui';
import { huddleApi, type HuddleComment } from '@lib/api';
import { MarkdownContent } from '../MarkdownContent';
import { HuddleAvatar } from '../HuddleAvatar';
import { getUserColor } from '../avatar';

function formatTimestamp(date: string) {
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
}

interface HuddleCommentsProps {
  postId: string;
  currentUserId: string;
  canDelete: boolean; // true if user is author, team admin, or org owner
  onCommentAdded?: () => void;
  onCommentDeleted?: () => void;
}

export function HuddleComments({
  postId,
  currentUserId,
  canDelete,
  onCommentAdded,
  onCommentDeleted,
}: HuddleCommentsProps) {
  const [comments, setComments] = useState<HuddleComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    loadComments();
  }, [postId]);

  async function loadComments() {
    try {
      setLoading(true);
      const result = await huddleApi.getComments(postId);
      // Normalize result shape: handle both { comments: [...] } and [...]
      const comments = Array.isArray(result)
        ? result
        : ((result as { comments?: unknown[] })?.comments ?? []);
      setComments(comments);
    } catch (error) {
      console.error('[HuddleComments] Failed to load comments:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    if (!newComment.trim() || submitting) return;

    try {
      setSubmitting(true);

      // Parse @mentions from content (format: @username or @jane)
      // Extract unique user IDs from mentions
      const mentionUserIds: string[] = [];

      // ⚠️ LIMITATION: @mentions currently send empty array to backend
      // This means @mention text is displayed but does NOT trigger notifications
      //
      // SOLUTION NEEDED:
      // 1. Add GET /v1/teams/:teamId/members endpoint to fetch team member list
      // 2. Add autocomplete dropdown that appears when typing '@' in comment box
      // 3. User selects from dropdown → frontend gets userId
      // 4. Pass mentions: [userId1, userId2] to backend
      // 5. Backend already validates mentions and sends notifications ✅
      //
      // Until implemented, @mentions are visual-only decoration

      await huddleApi.addComment(postId, {
        content: newComment,
        mentions: mentionUserIds,
      });
      setNewComment('');
      await loadComments();
      onCommentAdded?.();
    } catch (error) {
      console.error('[HuddleComments] Failed to add comment:', error);
      alert('Failed to add comment');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(commentId: string) {
    if (!confirm('Delete this comment?')) return;

    try {
      await huddleApi.deleteComment(commentId);
      await loadComments();
      onCommentDeleted?.(); // Notify parent to decrement count
    } catch (error) {
      console.error('[HuddleComments] Failed to delete comment:', error);
      alert('Failed to delete comment');
    }
  }

  if (loading) {
    return (
      <div className="px-5 py-4 text-center text-sm text-gray-400 dark:text-neutral-500">
        Loading comments...
      </div>
    );
  }

  return (
    <div className="border-t border-gray-100 dark:border-neutral-700 bg-gray-50/50 dark:bg-neutral-900/30">
      {/* Comments list */}
      {comments.length > 0 && (
        <div className="divide-y divide-gray-100 dark:divide-neutral-800">
          {comments.map((comment) => {
            const avatarColor = getUserColor(comment.userId);
            const isOwnComment = comment.userId === currentUserId;
            const canDeleteComment = canDelete || isOwnComment;

            return (
              <div key={comment.id} className="px-5 py-3 flex gap-2.5">
                <HuddleAvatar
                  initials={comment.userInitials}
                  color={avatarColor}
                  src={comment.userAvatarUrl}
                  size="sm"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-xs text-gray-900 dark:text-white">
                      {comment.userName}
                    </span>
                    <span className="text-xs text-gray-400 dark:text-neutral-500">
                      {formatTimestamp(comment.createdAt)}
                    </span>
                  </div>
                  <div className="prose prose-sm dark:prose-invert max-w-none text-sm text-gray-700 dark:text-neutral-300">
                    <MarkdownContent content={comment.content} />
                  </div>
                </div>
                {canDeleteComment && (
                  <button
                    onClick={() => handleDelete(comment.id)}
                    className="text-xs text-gray-400 dark:text-neutral-500 hover:text-red-500 dark:hover:text-red-400 transition-colors self-start"
                    title="Delete comment"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Comment composer */}
      <div className="px-5 py-3 border-t border-gray-100 dark:border-neutral-700">
        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            /* The composer had no accessible name; `hideLabel` adds one
               without changing what is rendered. */
            label="Comment"
            hideLabel
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Write a comment... (markdown supported)"
            className="flex-1"
            size="sm"
            resize="none"
            rows={2}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={!newComment.trim() || submitting}
            className="self-end px-4 py-2 text-sm font-medium text-white bg-indigo-500 rounded-lg hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Sending...' : 'Send'}
          </button>
        </div>
        <p className="text-xs text-gray-400 dark:text-neutral-600 mt-1.5">⌘↵ to send</p>
      </div>
    </div>
  );
}
