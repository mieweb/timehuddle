/**
 * HuddleComposer — post/edit composer for the Huddle feed.
 *
 * The editing surface is Kerebron's RichEditor (via @mieweb/ui/kerebron):
 * WYSIWYG ProseMirror with markdown in/out, replacing the old
 * textarea + markdown-toolbar + preview tabs. Posts keep storing markdown in
 * the existing `content.text` field, so legacy plain-text posts are
 * unaffected.
 *
 * RichEditor is uncontrolled — `initialText` applies on mount only. Hosts
 * editing an existing post must remount the composer with
 * `key={editingPostId ?? 'new'}`.
 */
import { useState, useEffect } from 'react';
import { RichEditor } from '@mieweb/ui/kerebron';
import { useTeam } from '@lib/TeamContext';
import { attachmentApi } from '@lib/api';
import { TicketPicker } from './TicketPicker';
import { AttachmentBar } from './AttachmentBar';
import { MentionMenu } from './MentionMenu';
import type { ComposerContent, MediaItem } from './types';

// ─── Types ────────────────────────────────────────────────────────────────────
interface HuddleComposerProps {
  onPost: (content: ComposerContent) => void;
  userInitials?: string;
  userColor?: 'indigo' | 'teal' | 'coral' | 'amber' | 'pink' | 'green';
  /**
   * Editing mode: initial markdown (e.g. today's post) loaded into the
   * editor. RichEditor is uncontrolled — the host must remount the composer
   * (key={editingPostId ?? 'new'}) when this changes.
   */
  initialText?: string;
  /** Label for the submit button (e.g. "Update post"). Defaults to "Post". */
  submitLabel?: string;
  /** Placeholder for the collapsed bar. */
  collapsedLabel?: string;
}

// ─── HuddleComposer ───────────────────────────────────────────────────────────
export function HuddleComposer({
  onPost,
  userInitials = 'PD',
  userColor = 'indigo',
  initialText = '',
  submitLabel = 'Post',
  collapsedLabel = 'Share an update...',
}: HuddleComposerProps) {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState(initialText);
  const [selectedTicketId, setSelectedTicketId] = useState<string | undefined>();
  const [attachments, setAttachments] = useState<MediaItem[]>([]);
  const [ticketVideos, setTicketVideos] = useState<MediaItem[]>([]);
  const [mentions, setMentions] = useState<Array<{ userId: string; name: string }>>([]);
  const { selectedTeamId } = useTeam();

  // Fetch videos attached to the selected ticket
  useEffect(() => {
    if (!selectedTicketId) {
      setTicketVideos([]);
      return;
    }

    let cancelled = false;

    async function fetchTicketVideos() {
      try {
        const attachments = await attachmentApi.list('ticket', selectedTicketId!);
        if (cancelled) return;

        // Extract video attachments
        const videos: MediaItem[] = attachments
          .filter((att) => att.type === 'video')
          .map((att) => ({
            id: att.id,
            url: att.url,
            filename: att.title || 'video',
            type: 'video',
            size: 0, // Size not available from backend
            mimeType: 'video/mp4',
          }));

        setTicketVideos(videos);
      } catch (error) {
        console.error('[HuddleComposer] Failed to fetch ticket videos:', error);
        setTicketVideos([]);
      }
    }

    fetchTicketVideos();

    return () => {
      cancelled = true;
    };
  }, [selectedTicketId]);

  const handleSubmit = () => {
    try {
      if (!text.trim() && attachments.length === 0 && ticketVideos.length === 0) return;

      // Combine user attachments with ticket videos
      const allAttachments = [...attachments, ...ticketVideos];

      onPost({
        text: text.trim() || '(Image post)',
        json: { text: text.trim() || '(Image post)' },
        ticketId: selectedTicketId,
        attachments: allAttachments,
        mentions,
      });
      setText(initialText);
      setExpanded(false);
      setSelectedTicketId(undefined);
      setAttachments([]);
      setTicketVideos([]);
      setMentions([]);
    } catch (error) {
      console.error('[HuddleComposer] Error in handleSubmit:', error);
      alert('Failed to post. Please try again.');
    }
  };

  const handleCancel = () => {
    setText(initialText);
    setExpanded(false);
    setSelectedTicketId(undefined);
    setAttachments([]);
    setTicketVideos([]);
    setMentions([]);
  };

  const handleAttachmentAdd = (media: MediaItem) => setAttachments((prev) => [...prev, media]);
  const handleAttachmentRemove = (mediaId: string) =>
    setAttachments((prev) => prev.filter((m) => m.id !== mediaId));

  // RichEditor has no insert-at-cursor API, so mentions are tracked as chips
  // below the editor instead of injected inline.
  const handleMentionSelect = (userId: string, name: string) => {
    setMentions((prev) =>
      prev.some((m) => m.userId === userId) ? prev : [...prev, { userId, name }],
    );
  };
  const handleMentionRemove = (userId: string) =>
    setMentions((prev) => prev.filter((m) => m.userId !== userId));

  const avatarColorClasses = {
    indigo: 'bg-indigo-100 text-indigo-600',
    teal: 'bg-teal-100 text-teal-600',
    coral: 'bg-red-100 text-red-500',
    amber: 'bg-amber-100 text-amber-600',
    pink: 'bg-pink-100 text-pink-500',
    green: 'bg-green-100 text-green-600',
  };

  // ─── Collapsed ──────────────────────────────────────────────────────────────
  if (!expanded) {
    return (
      <div
        className="flex items-center gap-3 px-5 py-3 bg-white dark:bg-neutral-800 cursor-pointer"
        onClick={() => setExpanded(true)}
      >
        <div
          className={`w-9 h-9 rounded-full flex items-center justify-center font-semibold shrink-0 ${avatarColorClasses[userColor]}`}
        >
          {userInitials}
        </div>
        <div className="flex-1 bg-gray-100 dark:bg-neutral-700 border border-gray-200 dark:border-neutral-600 rounded-full px-4 py-2.5 text-sm text-gray-400 dark:text-neutral-500">
          {collapsedLabel}
        </div>
        <button
          className="w-9 h-9 rounded-full bg-gray-100 dark:bg-neutral-700 border border-gray-200 dark:border-neutral-600 flex items-center justify-center shrink-0"
          aria-label="Open composer"
        >
          <svg
            className="w-4 h-4 text-gray-400 dark:text-neutral-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </button>
      </div>
    );
  }

  // ─── Expanded ───────────────────────────────────────────────────────────────
  return (
    <div className="px-5 py-3 border-b border-gray-100 dark:border-neutral-700 bg-white dark:bg-neutral-800">
      <div className="flex gap-3">
        <div
          className={`w-9 h-9 rounded-full flex items-center justify-center font-semibold shrink-0 ${avatarColorClasses[userColor]}`}
        >
          {userInitials}
        </div>

        <div className="flex-1 min-w-0">
          {/* ── Rich editor (Kerebron — markdown in/out) ── */}
          <div
            className="huddle-rich-editor rounded-lg border border-gray-200 dark:border-neutral-700 [&_.ProseMirror]:min-h-52 [&_.ProseMirror]:px-3 [&_.ProseMirror]:py-2.5 [&_.ProseMirror]:text-base [&_.ProseMirror]:leading-relaxed [&_.ProseMirror]:outline-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          >
            <RichEditor value={initialText} onChange={setText} />
          </div>

          {/* ── Ticket chip ── */}
          {selectedTicketId && (
            <div className="mt-2 inline-flex items-center gap-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-full px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"
                />
              </svg>
              Ticket #{selectedTicketId}
              <button
                onClick={() => setSelectedTicketId(undefined)}
                className="hover:text-amber-900 dark:hover:text-amber-200 transition-colors"
                aria-label="Remove ticket"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          )}

          {/* ── Mention chips ── */}
          {mentions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {mentions.map((m) => (
                <div
                  key={m.userId}
                  className="inline-flex items-center gap-1.5 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/50 rounded-full px-3 py-1 text-xs text-indigo-700 dark:text-indigo-300"
                >
                  @{m.name}
                  <button
                    onClick={() => handleMentionRemove(m.userId)}
                    className="hover:text-indigo-900 dark:hover:text-indigo-200 transition-colors"
                    aria-label={`Remove mention of ${m.name}`}
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* ── Attachments ── */}
          {(attachments.length > 0 || ticketVideos.length > 0) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {attachments.map((media) => (
                <div
                  key={media.id}
                  className="relative bg-gray-100 dark:bg-neutral-700 border border-gray-200 dark:border-neutral-600 rounded-lg p-2 text-xs text-gray-600 dark:text-neutral-300 flex items-center gap-2"
                >
                  {media.filename}
                  <button
                    onClick={() => handleAttachmentRemove(media.id)}
                    className="text-gray-400 dark:text-neutral-500 hover:text-gray-600 dark:hover:text-neutral-400 transition-colors"
                    aria-label={`Remove attachment ${media.filename}`}
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              ))}
              {ticketVideos.map((video) => (
                <div
                  key={video.id}
                  className="relative bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/50 rounded-lg p-2 text-xs text-indigo-700 dark:text-indigo-300 flex items-center gap-2"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                  {video.filename}
                  <span className="text-indigo-400 dark:text-indigo-600 text-xs">
                    (from ticket)
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* ── Button bar ── */}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <AttachmentBar onAttachmentAdd={handleAttachmentAdd} />
            {selectedTeamId && (
              <TicketPicker
                teamId={selectedTeamId}
                onSelect={setSelectedTicketId}
                selectedId={selectedTicketId}
              />
            )}
            {selectedTeamId && <MentionMenu teamId={selectedTeamId} onSelect={handleMentionSelect} />}
            <button
              onClick={handleCancel}
              className="text-xs text-gray-400 dark:text-neutral-500 hover:text-gray-600 dark:hover:text-neutral-400 transition-colors ml-1"
            >
              Cancel
            </button>
            <span className="text-xs text-gray-300 dark:text-neutral-600 ml-auto mr-2 hidden sm:block">
              ⌘↵ to post
            </span>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleSubmit();
              }}
              disabled={!text.trim() && attachments.length === 0 && ticketVideos.length === 0}
              className="text-xs font-semibold px-4 py-1.5 rounded-full bg-indigo-500 dark:bg-indigo-600 text-white hover:bg-indigo-600 dark:hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {submitLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
