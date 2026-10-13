/**
 * AttachmentsPanel — the videos on a ticket, a Redmine issue or a clock
 * session. **Pulse** records one on a phone and **Upload** sends a file from
 * this device; either way the server converts it and attaches it here when it
 * lands, and it plays here inline. A link goes in the description (or the
 * session's post), not here: links attached before that rule are still
 * listed, and can be removed.
 *
 * Usage:
 *   <AttachmentsPanel kind="clock" entityId={clockEventId} />
 *   <AttachmentsPanel kind="ticket" entityId={ticketId} />
 */
import { faTrash, faVideo } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Spinner, Text } from '@mieweb/ui';
import React, { useCallback, useEffect, useState } from 'react';

import {
  attachmentApi,
  resolveMediaUrl,
  type AttachmentKind,
  type Attachment,
} from '../../lib/api';
import { pulseArtifactId } from '../pulse-upload/artifact';
import { PulseButton } from '../pulse-upload/PulseButton';
import { PulseVideoPlayer } from '../pulse-upload/PulseVideoPlayer';

interface AttachmentsPanelProps {
  kind: AttachmentKind;
  entityId: string;
  currentUserId?: string;
  /** False where the host already names the section (a "Session videos" window). */
  showHeading?: boolean;
}

export const AttachmentsPanel: React.FC<AttachmentsPanelProps> = ({
  kind,
  entityId,
  currentUserId,
  showHeading = true,
}) => {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchAttachments = useCallback(async () => {
    setLoading(true);
    try {
      const data = await attachmentApi.list(kind, entityId);
      setAttachments(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [kind, entityId]);

  useEffect(() => {
    void fetchAttachments();
  }, [fetchAttachments]);

  const handleRemove = useCallback(async (id: string) => {
    setDeletingId(id);
    try {
      await attachmentApi.remove(id);
      setAttachments((prev) => prev.filter((a) => a.id !== id));
    } finally {
      setDeletingId(null);
    }
  }, []);

  return (
    <section className="attachments-panel">
      {/* Wraps instead of squeezing: on a phone the chips (and the upload's
          status line beside them) drop under the heading. */}
      <div className="attachments-header mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {showHeading && (
          <Text
            as="h3"
            size="sm"
            className="flex items-center gap-1.5 font-semibold text-neutral-700 dark:text-neutral-300"
          >
            <FontAwesomeIcon icon={faVideo} size="sm" aria-hidden />
            Videos
          </Text>
        )}
        <PulseButton
          destination={{ kind, id: entityId }}
          ariaLabel="Add a video with Pulse"
          allowFile
          onSettled={(status) => status.state === 'done' && void fetchAttachments()}
        />
      </div>

      {loading && <Spinner size="sm" />}

      {!loading && attachments.length === 0 && (
        <Text size="xs" variant="muted">
          No videos yet.
        </Text>
      )}

      <ul className="attachment-list flex flex-col gap-1" aria-label="Videos">
        {attachments.map((a) => {
          // Same rule as the Huddle feed: a video that's a PulseVault artifact
          // plays inline; anything else is a link.
          const videoId = a.type === 'video' ? pulseArtifactId(a.url) : null;
          return (
            <li
              key={a.id}
              className="attachment-item flex items-center justify-between gap-2 text-sm"
            >
              {videoId ? (
                <figure className="attachment-video min-w-0">
                  <PulseVideoPlayer video={videoId} title={a.title ?? undefined} />
                  {a.title && (
                    <figcaption className="attachment-video-title truncate text-xs text-muted-foreground">
                      {a.title}
                    </figcaption>
                  )}
                </figure>
              ) : (
                // A link attached before links moved to the description passes
                // through resolveMediaUrl untouched; a backend path is bound to
                // the current origin.
                <a
                  href={resolveMediaUrl(a.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="attachment-link min-w-0 truncate text-primary hover:underline"
                >
                  {a.title ?? a.url}
                </a>
              )}
              {currentUserId && currentUserId === a.addedBy && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleRemove(a.id)}
                  isLoading={deletingId === a.id}
                  aria-label={`Remove ${a.title ?? (videoId ? 'video' : a.url)}`}
                >
                  <FontAwesomeIcon icon={faTrash} className="text-destructive" aria-hidden />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};
