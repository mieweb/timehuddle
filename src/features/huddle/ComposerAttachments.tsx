/**
 * Shared attach/ticket/mention controls and chips for post composers — the
 * Clock page's plan/wrap-up composer and the Huddle inbox's message box offer
 * the same Photo/Video/Doc/Pulse/Ticket/@Mention affordances from here.
 */
import { Badge } from '@mieweb/ui';
import { AttachmentBar } from './AttachmentBar';
import { PulseAttachButton } from './PulseAttachButton';
import { TicketPicker } from './TicketPicker';
import { MentionMenu } from './MentionMenu';
import type { MediaItem } from './types';

export type MentionRef = { userId: string; name: string };

interface ComposerAttachButtonsProps {
  teamId?: string | null;
  onAttachmentAdd: (media: MediaItem) => void;
  selectedTicketId?: string;
  onTicketSelect: (ticketId: string) => void;
  onMentionSelect: (userId: string, name: string) => void;
  /**
   * Stable id for this composer, so a Pulse recording started here resumes into
   * *this* composer after the app is backgrounded — see {@link PulseAttachButton}.
   */
  pulseScope?: string;
  /** Fraction (0–1) of an in-flight attachment upload, or null when idle. */
  onUploadProgress?: (fraction: number | null) => void;
  /** Called with the reason a pick didn't attach — see {@link useAttachmentUpload}. */
  onError?: (message: string | null) => void;
  /**
   * Whether a Pulse recording is reserved but not yet attached. Hosts treat
   * this as in-flight work and keep submit closed until it lands or is
   * cancelled — see {@link PulseAttachButton}.
   */
  onPulsePendingChange?: (pending: boolean) => void;
}

/** The Photo / Video / Doc / Pulse / Ticket / @Mention button row. */
export function ComposerAttachButtons({
  teamId,
  onAttachmentAdd,
  selectedTicketId,
  onTicketSelect,
  onMentionSelect,
  pulseScope,
  onUploadProgress,
  onError,
  onPulsePendingChange,
}: ComposerAttachButtonsProps) {
  return (
    <>
      <AttachmentBar
        onAttachmentAdd={onAttachmentAdd}
        onUploadProgress={onUploadProgress}
        onError={onError}
      />
      {/* Keyed by scope: PulseAttachButton reads its pending reservation from
          the scope only on mount, so a scope change (e.g. clock plan → wrap-up)
          must remount it rather than carry over the old reservation. */}
      <PulseAttachButton
        key={pulseScope}
        onAttach={onAttachmentAdd}
        scope={pulseScope}
        onPendingChange={onPulsePendingChange}
      />
      {teamId && (
        <TicketPicker teamId={teamId} onSelect={onTicketSelect} selectedId={selectedTicketId} />
      )}
      {teamId && <MentionMenu teamId={teamId} onSelect={onMentionSelect} />}
    </>
  );
}

interface ComposerChipsProps {
  selectedTicketId?: string;
  onTicketRemove: () => void;
  mentions: MentionRef[];
  onMentionRemove: (userId: string) => void;
  attachments: MediaItem[];
  onAttachmentRemove: (mediaId: string) => void;
}

/** Ticket / mention / attachment chips selected in the composer so far. */
export function ComposerChips({
  selectedTicketId,
  onTicketRemove,
  mentions,
  onMentionRemove,
  attachments,
  onAttachmentRemove,
}: ComposerChipsProps) {
  const hasChips = selectedTicketId || mentions.length > 0 || attachments.length > 0;
  if (!hasChips) return null;

  return (
    <>
      {selectedTicketId && (
        /* Badge has no amber/indigo variant, so the tint rides on className. */
        <Badge
          size="sm"
          className="mt-2 gap-2 border border-amber-200 bg-amber-50 px-3 py-1.5 text-amber-700 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-300"
        >
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
            type="button"
            onClick={onTicketRemove}
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
        </Badge>
      )}

      {mentions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {mentions.map((m) => (
            <Badge
              key={m.userId}
              size="sm"
              className="gap-1.5 border border-indigo-200 bg-indigo-50 px-3 py-1 text-indigo-700 dark:border-indigo-800/50 dark:bg-indigo-950/30 dark:text-indigo-300"
            >
              @{m.name}
              <button
                type="button"
                onClick={() => onMentionRemove(m.userId)}
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
            </Badge>
          ))}
        </div>
      )}

      {attachments.length > 0 && (
        <div className="mt-2 flex min-w-0 max-w-full flex-wrap gap-2">
          {attachments.map((media) => (
            /* `rounded-lg` overrides Badge's pill shape — file chips are square. */
            <Badge
              key={media.id}
              size="sm"
              className="relative max-w-full min-w-0 gap-2 rounded-lg border border-gray-200 bg-gray-100 p-2 text-gray-600 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-300"
            >
              <span className="truncate" title={media.filename}>
                {media.filename}
              </span>
              <button
                type="button"
                onClick={() => onAttachmentRemove(media.id)}
                className="shrink-0 text-gray-400 dark:text-neutral-500 hover:text-gray-600 dark:hover:text-neutral-400 transition-colors"
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
            </Badge>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Videos pulled in from the post's ticket (see useTicketVideos). Not removable:
 * they come with the ticket, so removing the ticket removes them.
 */
export function TicketVideoChips({ videos }: { videos: MediaItem[] }) {
  if (videos.length === 0) return null;
  return (
    <div className="flex min-w-0 max-w-full flex-wrap gap-2">
      {videos.map((video) => (
        <Badge
          key={video.id}
          size="sm"
          className="max-w-full min-w-0 gap-2 rounded-lg border border-indigo-200 bg-indigo-50 p-2 text-indigo-700 dark:border-indigo-800/50 dark:bg-indigo-950/30 dark:text-indigo-300"
        >
          <svg
            className="h-3.5 w-3.5 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
          <span className="truncate" title={video.filename}>
            {video.filename}
          </span>
          <span className="shrink-0 text-xs text-indigo-500 dark:text-indigo-400">
            (from ticket)
          </span>
        </Badge>
      ))}
    </div>
  );
}
