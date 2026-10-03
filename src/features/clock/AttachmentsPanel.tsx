/**
 * AttachmentsPanel — Add, list, and remove attachments for a clock entry or
 * ticket. Two chips add to it: **Link** (a pasted URL — a YouTube Short, a
 * Loom, any page) and **Pulse** (a video from the Pulse app, which the server
 * attaches here when it lands; videos come from Pulse only).
 *
 * Usage:
 *   <AttachmentsPanel kind="clock" entityId={clockEventId} />
 *   <AttachmentsPanel kind="ticket" entityId={ticketId} />
 */
import { faLink, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, ButtonGroup, Spinner, Text } from '@mieweb/ui';
import React, { useCallback, useEffect, useState } from 'react';

import {
  attachmentApi,
  resolveMediaUrl,
  type AttachmentKind,
  type AttachmentType,
  type Attachment,
} from '../../lib/api';
import { LinkAttachButton } from './LinkAttachButton';
import type { AddedLink } from './linkAttach';
import { PulseButton } from '../pulse-upload/PulseButton';

interface AttachmentsPanelProps {
  kind: AttachmentKind;
  entityId: string;
  currentUserId?: string;
}

/** What a pasted link is, from its URL alone. */
function guessType(url: string): AttachmentType {
  const lower = url.toLowerCase();
  if (
    lower.includes('youtube') ||
    lower.includes('youtu.be') ||
    lower.includes('vimeo') ||
    lower.includes('loom')
  ) {
    return 'video';
  }
  if (/\.(png|jpe?g|gif|webp|svg)(\?|$)/.test(lower)) return 'image';
  return 'link';
}

export const AttachmentsPanel: React.FC<AttachmentsPanelProps> = ({
  kind,
  entityId,
  currentUserId,
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

  const handleAddLink = useCallback(
    async ({ url, title }: AddedLink) => {
      await attachmentApi.add({
        url,
        type: guessType(url),
        title: title ?? undefined,
        attachedTo: { kind, id: entityId },
      });
      await fetchAttachments();
    },
    [kind, entityId, fetchAttachments],
  );

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
    <div className="attachments-panel mt-3">
      <div className="attachments-header flex items-center justify-between mb-2">
        <Text size="sm" className="font-medium flex items-center gap-1">
          <FontAwesomeIcon icon={faLink} size="sm" />
          Links and videos
        </Text>
        <ButtonGroup orientation="horizontal" className="attachments-actions">
          <LinkAttachButton onAdd={handleAddLink} />
          <PulseButton
            destination={{ kind, id: entityId }}
            ariaLabel="Add a video with Pulse"
            onSettled={(status) => status.state === 'done' && void fetchAttachments()}
          />
        </ButtonGroup>
      </div>

      {loading && <Spinner size="sm" />}

      {!loading && attachments.length === 0 && (
        <Text size="xs" variant="muted">
          Nothing attached yet.
        </Text>
      )}

      <ul className="attachment-list flex flex-col gap-1" aria-label="Attachments">
        {attachments.map((a) => (
          <li
            key={a.id}
            className="attachment-item flex items-center justify-between gap-2 text-sm"
          >
            {/* Backend-hosted attachments (Pulse videos) are stored by path
                and bound to the current origin here; user-entered links pass
                through resolveMediaUrl untouched. */}
            <a
              href={resolveMediaUrl(a.url)}
              target="_blank"
              rel="noopener noreferrer"
              className="attachment-link truncate text-primary hover:underline"
              aria-label={a.title ?? a.url}
            >
              {a.title ?? a.url}
            </a>
            {currentUserId && currentUserId === a.addedBy && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleRemove(a.id)}
                isLoading={deletingId === a.id}
                aria-label="Remove link"
              >
                <FontAwesomeIcon icon={faTrash} className="text-destructive" />
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};
