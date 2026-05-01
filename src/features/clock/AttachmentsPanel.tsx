/**
 * AttachmentsPanel — Add, list, and remove media attachments for a clock entry or ticket.
 *
 * Usage:
 *   <AttachmentsPanel kind="clock" entityId={clockEventId} />
 *   <AttachmentsPanel kind="ticket" entityId={ticketId} />
 */
import { faLink, faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Input, Select, Spinner, Text } from '@mieweb/ui';
import { getYouTubeTitleFromUrl, isYouTubeUrl } from '@timehuddle/youtube';
import React, { useCallback, useEffect, useState } from 'react';

import {
  attachmentApi,
  type AttachmentKind,
  type AttachmentType,
  type Attachment,
} from '../../lib/api';

interface AttachmentsPanelProps {
  kind: AttachmentKind;
  entityId: string;
  currentUserId?: string;
}

const TYPE_OPTIONS: { value: AttachmentType; label: string }[] = [
  { value: 'video', label: 'Video' },
  { value: 'image', label: 'Image' },
  { value: 'link', label: 'Link' },
];

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
  const [showForm, setShowForm] = useState(false);
  const [url, setUrl] = useState('');
  const [type, setType] = useState<AttachmentType>('link');
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
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

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setUrl(val);
    if (val.trim()) {
      setType(guessType(val));
      if (isYouTubeUrl(val) && !title.trim()) {
        void getYouTubeTitleFromUrl(val).then((resolved) => {
          if (resolved) setTitle((prev) => (prev.trim() ? prev : resolved));
        });
      }
    }
  };

  const handleSubmit = useCallback(async () => {
    if (!url.trim()) return;
    setSubmitting(true);
    try {
      await attachmentApi.add({
        url: url.trim(),
        type,
        title: title.trim() || undefined,
        attachedTo: { kind, id: entityId },
      });
      setUrl('');
      setTitle('');
      setType('link');
      setShowForm(false);
      await fetchAttachments();
    } finally {
      setSubmitting(false);
    }
  }, [url, type, title, kind, entityId, fetchAttachments]);

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
          <FontAwesomeIcon icon={faLink} className="text-muted-foreground" />
          Links
        </Text>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setShowForm((v) => !v)}
          aria-label="Add link"
        >
          <FontAwesomeIcon icon={faPlus} className="mr-1" />
          Add
        </Button>
      </div>

      {showForm && (
        <div className="attachment-form flex flex-col gap-2 mb-3 p-3 rounded-md border border-border bg-muted/30">
          <Input
            label="URL"
            hideLabel
            type="url"
            placeholder="https://..."
            value={url}
            onChange={handleUrlChange}
            autoFocus
          />
          <Input
            label="Title (optional)"
            hideLabel
            type="text"
            placeholder="Title (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Select
            label="Type"
            hideLabel
            value={type}
            onValueChange={(val) => setType(val as AttachmentType)}
            options={TYPE_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
            aria-label="Attachment type"
          />
          <div className="attachment-form-actions flex gap-2 justify-end">
            <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSubmit} isLoading={submitting} disabled={!url.trim()}>
              Save
            </Button>
          </div>
        </div>
      )}

      {loading && <Spinner size="sm" />}

      {!loading && attachments.length === 0 && !showForm && (
        <Text size="xs" variant="muted">
          No links attached.
        </Text>
      )}

      <ul className="attachment-list flex flex-col gap-1" aria-label="Attached links">
        {attachments.map((a) => (
          <li
            key={a.id}
            className="attachment-item flex items-center justify-between gap-2 text-sm"
          >
            <a
              href={a.url}
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
