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
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTeam } from '@lib/TeamContext';
import { attachmentApi } from '@lib/api';
import { MarkdownEditor } from './MarkdownEditor';
import { ComposerAttachButtons, ComposerChips, type MentionRef } from './ComposerAttachments';
import { ComposerProgress } from './ComposerProgress';
import { useAttachmentUpload } from './useAttachmentUpload';
import { clearComposerPulseUpload } from './pulseComposerUpload';
import { huddlePostCollab } from './collab';
import type { ComposerContent, MediaItem } from './types';

// ─── Types ────────────────────────────────────────────────────────────────────
interface HuddleComposerProps {
  onPost: (content: ComposerContent) => Promise<void>;
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
  /**
   * Edit mode: start expanded with no collapsed bar / click-outside collapse.
   * Submit and Cancel defer to the host (via onPost / onCancel) instead of
   * resetting the composer in place.
   */
  editing?: boolean;
  /** Called when the user cancels in edit mode. */
  onCancel?: () => void;
  /** Attachments preloaded into the composer (edit mode). */
  initialAttachments?: MediaItem[];
  /** Ticket preselected in the composer (edit mode). */
  initialTicketId?: string;
  /** Mentions preloaded into the composer (edit mode). */
  initialMentions?: MentionRef[];
  /**
   * When set, enables live collaborative editing (Yjs) for this room — every
   * peer editing the same post co-edits one shared document. Only meaningful
   * for an existing post (room = post id); leave unset for new posts.
   */
  collabRoom?: string;
}

// ─── HuddleComposer ───────────────────────────────────────────────────────────
export function HuddleComposer({
  onPost,
  userInitials = 'PD',
  userColor = 'indigo',
  initialText = '',
  submitLabel = 'Post',
  collapsedLabel = 'Share an update...',
  editing = false,
  onCancel,
  initialAttachments,
  initialTicketId,
  initialMentions,
  collabRoom,
}: HuddleComposerProps) {
  const [expanded, setExpanded] = useState(editing);
  const [text, setText] = useState(initialText);
  const [selectedTicketId, setSelectedTicketId] = useState<string | undefined>(initialTicketId);
  const [attachments, setAttachments] = useState<MediaItem[]>(initialAttachments ?? []);
  const [ticketVideos, setTicketVideos] = useState<MediaItem[]>([]);
  const [mentions, setMentions] = useState<MentionRef[]>(initialMentions ?? []);
  const [posting, setPosting] = useState(false);
  const [postDone, setPostDone] = useState(false);
  // Completed fraction (0–1) of an attachment upload in flight, or null when
  // none is. Drives the same bar as posting does, so uploading a video and
  // submitting the post read as one continuous operation.
  const [uploadFraction, setUploadFraction] = useState<number | null>(null);
  const { selectedTeamId } = useTeam();
  const composerRef = useRef<HTMLDivElement>(null);

  // Stable localStorage scope for the Pulse upload button — also the key this
  // composer clears once a post is submitted/cancelled so a finished video
  // isn't re-attached to the next post. Scoped by team so switching teams
  // while a recording is pending can't hand that video to the new team's post.
  const pulseScope = editing
    ? `huddle-edit-${collabRoom ?? 'post'}`
    : `huddle-new-${selectedTeamId ?? 'none'}`;

  // Click-outside → collapse (only when empty, so in-progress writing is never
  // lost). Frees up feed space when you're not actively composing. Disabled in
  // edit mode — the host owns dismissal there.
  useEffect(() => {
    if (!expanded || editing) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (composerRef.current?.contains(e.target as Node)) return;
      // Kerebron popovers (toolbar dropdowns) and the Pulse upload modal
      // (portaled outside composerRef) must not trigger a collapse — closing
      // either one is not "clicking away" from the composer.
      if (
        (e.target as HTMLElement).closest?.(
          '.kb-custom-menu__wrapper, [role="menu"], [role="dialog"]',
        )
      )
        return;
      const hasContent = text.trim() || attachments.length > 0;
      if (!hasContent) handleCancel();
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [expanded, text, attachments.length]);

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

  const hasContent = !!text.trim() || attachments.length > 0 || ticketVideos.length > 0;
  // Posting mid-upload would drop the attachment still on the wire, so the
  // button stays disabled until every attachment has landed.
  const canSubmit = hasContent && !posting && uploadFraction === null;

  const handleSubmit = async () => {
    if (!canSubmit) return;

    const allAttachments = [...attachments, ...ticketVideos];
    const base = text.trim();
    const mentionSuffix = mentions
      .filter((m) => !base.includes(`@${m.name}`))
      .map((m) => `@${m.name}`)
      .join(' ');
    const finalText = [base, mentionSuffix].filter(Boolean).join(' ');

    setPosting(true);
    setPostDone(false);
    try {
      await onPost({
        text: finalText,
        json: { text: finalText },
        ticketId: selectedTicketId,
        attachments: allAttachments,
        mentions,
      });
      setPostDone(true);
      // Clear the reservation for every successful submit, before branching on
      // `editing` — otherwise reopening the same post within the TTL reattaches
      // the video that was just submitted.
      clearComposerPulseUpload(pulseScope);
      // Hold at 100% briefly so the user sees the bar complete
      await new Promise<void>((r) => setTimeout(r, 400));
      // In edit mode the host closes the composer once the update resolves
      if (!editing) {
        setText(initialText);
        setExpanded(false);
        setSelectedTicketId(undefined);
        setAttachments([]);
        setTicketVideos([]);
        setMentions([]);
      }
    } catch (error) {
      console.error('[HuddleComposer] Error in handleSubmit:', error);
      alert('Failed to post. Please try again.');
    } finally {
      setPosting(false);
      setPostDone(false);
    }
  };

  const handleCancel = () => {
    // Clear before the editing early return — a recording that finishes after
    // cancellation must not be restored the next time this post is edited.
    clearComposerPulseUpload(pulseScope);
    if (editing) {
      onCancel?.();
      return;
    }
    setText(initialText);
    setExpanded(false);
    setSelectedTicketId(undefined);
    setAttachments([]);
    setTicketVideos([]);
    setMentions([]);
  };

  // useCallback: this is the hook's dependency, and through it the identity of
  // the paste handler MarkdownEditor binds a native listener to. Unmemoized it
  // would tear down and re-register that listener on every keystroke.
  const handleAttachmentAdd = useCallback(
    (media: MediaItem) =>
      setAttachments((prev) => (prev.some((m) => m.id === media.id) ? prev : [...prev, media])),
    [],
  );
  const handleAttachmentRemove = (mediaId: string) => {
    // Removing the Pulse video chip also forgets its persisted upload, so it
    // won't reappear when the composer remounts.
    const removed = attachments.find((m) => m.id === mediaId);
    if (removed?.type === 'video') clearComposerPulseUpload(pulseScope);
    setAttachments((prev) => prev.filter((m) => m.id !== mediaId));
  };

  // Pasted screenshots go through the same upload as the Photo button, so they
  // land in the media store and post as real attachments instead of being
  // embedded in the post text as base64.
  const { upload: uploadPastedImages } = useAttachmentUpload({
    onAttachmentAdd: handleAttachmentAdd,
    onUploadProgress: setUploadFraction,
  });

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
        className="flex items-center gap-3 px-3 py-2 bg-white dark:bg-neutral-800 cursor-pointer"
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
      </div>
    );
  }

  // ─── Expanded ───────────────────────────────────────────────────────────────
  return (
    <div
      ref={composerRef}
      className="px-3 py-2 border-b border-gray-100 dark:border-neutral-700 bg-white dark:bg-neutral-800"
    >
      {/* ── Rich editor (Kerebron — markdown in/out, working toolbar) ── */}
      <MarkdownEditor
        // RichEditor is uncontrolled and reads `collab`/`value` only at mount.
        // Key it on the editing target so switching into an edit composer always
        // mounts a fresh editor that seeds from the post's existing text.
        key={editing ? `edit-${collabRoom ?? 'new'}` : 'compose'}
        value={text}
        onChange={setText}
        onSubmit={handleSubmit}
        onImagePaste={uploadPastedImages}
        collab={huddlePostCollab(collabRoom)}
        placeholder="What's on your mind?"
      />

      {/* ── Ticket / mention / attachment chips ── */}
      <ComposerChips
        selectedTicketId={selectedTicketId}
        onTicketRemove={() => setSelectedTicketId(undefined)}
        mentions={mentions}
        onMentionRemove={handleMentionRemove}
        attachments={attachments}
        onAttachmentRemove={handleAttachmentRemove}
      />

      {/* ── Ticket videos (auto-attached from the selected ticket) ── */}
      {ticketVideos.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {ticketVideos.map((video) => (
            <div
              key={video.id}
              className="relative bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/50 rounded-lg p-2 text-xs text-indigo-700 dark:text-indigo-300 flex items-center gap-2"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              {video.filename}
              <span className="text-indigo-400 dark:text-indigo-600 text-xs">(from ticket)</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Button bar ── */}
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <ComposerAttachButtons
          teamId={selectedTeamId}
          pulseScope={pulseScope}
          onAttachmentAdd={handleAttachmentAdd}
          selectedTicketId={selectedTicketId}
          onTicketSelect={setSelectedTicketId}
          onMentionSelect={handleMentionSelect}
          onUploadProgress={setUploadFraction}
        />
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
          disabled={!canSubmit}
          className="text-xs font-semibold px-4 py-1.5 rounded-full bg-indigo-500 dark:bg-indigo-600 text-white hover:bg-indigo-600 dark:hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {posting ? 'Posting…' : submitLabel}
        </button>
      </div>

      {/* ── Progress bar — spans the composer for both phases: attachment
           uploads (determinate, real bytes) and the post itself. ── */}
      <ComposerProgress uploadFraction={uploadFraction} posting={posting} postDone={postDone} />
    </div>
  );
}
