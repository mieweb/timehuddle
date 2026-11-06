/**
 * Shared attach/ticket/mention controls and chips for post composers — the
 * Clock page's plan/wrap-up composer and the Huddle inbox's message box offer
 * the same Photo/Video/Doc/Ticket/@Mention affordances from here. Pulse is not
 * a composer attachment: a Pulse video is delivered by the server to where its
 * link was reserved for (see PulseButton), so it has its own button.
 */
import { AttachmentPreviewItem, Badge, UploadAnnouncer, type AttachmentUpload } from '@mieweb/ui';
import { UPLOAD_TEXT } from './uploadText';
import { AttachmentBar } from './AttachmentBar';
import { TicketPicker } from './TicketPicker';
import { MentionMenu } from './MentionMenu';
import { timerLabel } from '../timers/ticketTimerStrings';
import type { MediaItem } from './types';
import type { TicketRef } from './useTicketSelection';

export type MentionRef = { userId: string; name: string };

/** User-facing text for the ticket chips, kept in one place for translation. */
export const TICKET_CHIP_TEXT = {
  remove: (label: string) => `Remove ticket ${label}`,
};

interface ComposerAttachButtonsProps {
  teamId?: string | null;
  /** Called with each picked file, to stage and upload (useComposerUploads). */
  onFiles: (files: File[]) => void;
  selectedTicketIds: string[];
  /** Adds a ticket to the post; the picker won't offer one already attached. */
  onTicketSelect: (ticket: TicketRef) => void;
  onMentionSelect: (userId: string, name: string) => void;
}

/** The Photo / Video / Doc / Ticket / @Mention button row. */
export function ComposerAttachButtons({
  teamId,
  onFiles,
  selectedTicketIds,
  onTicketSelect,
  onMentionSelect,
}: ComposerAttachButtonsProps) {
  return (
    <>
      <AttachmentBar onFiles={onFiles} />
      {teamId && (
        <TicketPicker teamId={teamId} onSelect={onTicketSelect} selectedIds={selectedTicketIds} />
      )}
      {teamId && <MentionMenu teamId={teamId} onSelect={onMentionSelect} />}
    </>
  );
}

interface ComposerChipsProps {
  selectedTickets: TicketRef[];
  onTicketRemove: (ticketId: string) => void;
  mentions: MentionRef[];
  onMentionRemove: (userId: string) => void;
  /** Files staged in the composer, each uploading in place (useComposerUploads). */
  attachments: AttachmentUpload<MediaItem>[];
  /** Takes a file off: cancels its upload, or takes a finished one back. */
  onAttachmentRemove: (id: string) => void;
  /** Uploads a failed file again. */
  onAttachmentRetry?: (id: string) => void;
}

/** Ticket / mention / attachment chips selected in the composer so far. */
export function ComposerChips({
  selectedTickets,
  onTicketRemove,
  mentions,
  onMentionRemove,
  attachments,
  onAttachmentRemove,
  onAttachmentRetry,
}: ComposerChipsProps) {
  const hasChips = selectedTickets.length > 0 || mentions.length > 0 || attachments.length > 0;
  if (!hasChips) return null;

  return (
    <>
      {selectedTickets.length > 0 && (
        <div className="mt-2 flex min-w-0 max-w-full flex-wrap gap-2">
          {selectedTickets.map((ticket) => {
            // The title, or the short ref (#91234) when it's unknown, e.g. a deleted ticket.
            const label = timerLabel('huddle', ticket.id, ticket.title);
            return (
              /* Badge has no amber/indigo variant, so the tint rides on className. */
              <Badge
                key={ticket.id}
                size="sm"
                className="max-w-full min-w-0 gap-2 border border-amber-200 bg-amber-50 px-3 py-1.5 text-amber-700 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-300"
              >
                <svg
                  className="w-3 h-3 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"
                  />
                </svg>
                <span className="truncate" title={label}>
                  {label}
                </span>
                <button
                  type="button"
                  onClick={() => onTicketRemove(ticket.id)}
                  className="shrink-0 hover:text-amber-900 dark:hover:text-amber-200 transition-colors"
                  aria-label={TICKET_CHIP_TEXT.remove(label)}
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
            );
          })}
        </div>
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

      {/* Said as files upload, as Huddle's message box says it. */}
      <UploadAnnouncer items={attachments} labels={UPLOAD_TEXT} />
      {attachments.length > 0 && (
        <div className="composer-attachments mt-2 flex min-w-0 max-w-full flex-wrap gap-2">
          {attachments.map((upload) => {
            const busy = upload.state === 'uploading' || upload.state === 'processing';
            const name = upload.file.name;
            return (
              <AttachmentPreviewItem
                key={upload.id}
                attachment={{
                  ...upload,
                  // Processing (the server finishing) is still a busy tile.
                  state: busy ? 'uploading' : (upload.state as 'pending' | 'uploaded' | 'failed'),
                  // Processing is the state's, not a rounded 100%.
                  progress:
                    upload.state === 'processing'
                      ? 100
                      : busy
                        ? Math.min(99, Math.round(upload.progress * 100))
                        : undefined,
                }}
                onRemove={() => onAttachmentRemove(upload.id)}
                onRetry={onAttachmentRetry && (() => onAttachmentRetry(upload.id))}
                progressLabel={UPLOAD_TEXT.uploading(name)}
                processingLabel={UPLOAD_TEXT.processing}
                retryLabel={UPLOAD_TEXT.retry}
                removeLabel={busy ? UPLOAD_TEXT.cancel(name) : UPLOAD_TEXT.remove(name)}
              />
            );
          })}
        </div>
      )}
    </>
  );
}

/**
 * Videos pulled in from the post's tickets (see useTicketVideos). Not removable:
 * they come with a ticket, so removing that ticket removes them.
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
