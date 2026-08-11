/**
 * Shared attach/ticket/mention controls for post composers — the action bar
 * and chip rows factored out of HuddleComposer so other composers (e.g. the
 * Clock page's plan/wrap-up composer) can offer the same Photo/Video/Doc/
 * Pulse/Ticket/@Mention affordances without duplicating the markup.
 */
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
}

/** The Photo / Video / Doc / Pulse / Ticket / @Mention button row. */
export function ComposerAttachButtons({
  teamId,
  onAttachmentAdd,
  selectedTicketId,
  onTicketSelect,
  onMentionSelect,
  pulseScope,
}: ComposerAttachButtonsProps) {
  return (
    <>
      <AttachmentBar onAttachmentAdd={onAttachmentAdd} />
      <PulseAttachButton onAttach={onAttachmentAdd} scope={pulseScope} />
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
        </div>
      )}

      {mentions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {mentions.map((m) => (
            <div
              key={m.userId}
              className="inline-flex items-center gap-1.5 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/50 rounded-full px-3 py-1 text-xs text-indigo-700 dark:text-indigo-300"
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
            </div>
          ))}
        </div>
      )}

      {attachments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {attachments.map((media) => (
            <div
              key={media.id}
              className="relative bg-gray-100 dark:bg-neutral-700 border border-gray-200 dark:border-neutral-600 rounded-lg p-2 text-xs text-gray-600 dark:text-neutral-300 flex items-center gap-2"
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
            </div>
          ))}
        </div>
      )}
    </>
  );
}
