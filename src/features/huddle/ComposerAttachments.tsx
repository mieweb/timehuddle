/**
 * Shared attach/ticket/mention controls for post composers — the action bar
 * and chip rows factored out of HuddleComposer so other composers (e.g. the
 * Clock page's plan/wrap-up composer) can offer the same Photo/Doc/
 * Ticket/@Mention affordances without duplicating the markup.
 *
 * Pulse isn't here: a Pulse upload posts itself (the server delivers it the
 * moment it lands), so it sits beside the composer, not inside it, where text
 * typed here couldn't go with it — see PulseButton.
 */
import { Badge } from '@mieweb/ui';
import { AttachmentBar } from './AttachmentBar';
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
  /** Fraction (0–1) of an in-flight attachment upload, or null when idle. */
  onUploadProgress?: (fraction: number | null) => void;
  /** Called with the reason a pick didn't attach — see {@link useAttachmentUpload}. */
  onError?: (message: string | null) => void;
}

/** The Photo / Doc / Ticket / @Mention button row. Links go in the post text. */
export function ComposerAttachButtons({
  teamId,
  onAttachmentAdd,
  selectedTicketId,
  onTicketSelect,
  onMentionSelect,
  onUploadProgress,
  onError,
}: ComposerAttachButtonsProps) {
  return (
    <>
      <AttachmentBar
        onAttachmentAdd={onAttachmentAdd}
        onUploadProgress={onUploadProgress}
        onError={onError}
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
        <div className="mt-2 flex flex-wrap gap-2">
          {attachments.map((media) => (
            /* `rounded-lg` overrides Badge's pill shape — file chips are square. */
            <Badge
              key={media.id}
              size="sm"
              className="relative gap-2 rounded-lg border border-gray-200 bg-gray-100 p-2 text-gray-600 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-300"
            >
              {media.filename}
              <button
                type="button"
                onClick={() => onAttachmentRemove(media.id)}
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
            </Badge>
          ))}
        </div>
      )}
    </>
  );
}
