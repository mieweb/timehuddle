/**
 * AttachmentsPanel — the videos on a ticket or a clock session. **Pulse**
 * records one on a phone and **Upload** sends a file from this device; either
 * way the server converts it when it can and attaches it here when it lands,
 * and it shows here with its name on its poster; ▶ plays it in a feed of
 * this list's videos (VideoFeedView). A video has one name (the
 * Pulse draft's, or the file's), which its owner renames here and which shows
 * wherever else it appears. A link goes in the description (or the session's
 * post), not here: links attached before that rule are still listed, and can
 * be removed.
 *
 * Usage:
 *   <AttachmentsPanel kind="clock" entityId={clockEventId} />
 *   <AttachmentsPanel kind="ticket" entityId={ticketId} />
 */
import { faTrash, faVideo } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, DropzoneOverlay, Spinner, Text, useDropzone } from '@mieweb/ui';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import {
  attachmentApi,
  resolveMediaUrl,
  type AttachmentKind,
  type Attachment,
} from '../../lib/api';
import { pulseArtifactId, videoLabel } from '../pulse-upload/artifact';
import { PendingVideoCard } from '../pulse-upload/PendingVideoCard';
import { PulseControls } from '../pulse-upload/PulseButton';
import { VIDEO_FILE_ACCEPT } from '../pulse-upload/videoFile';
import { usePulseUpload } from '../pulse-upload/usePulseUpload';
import { PulseVideoPlayer } from '../pulse-upload/PulseVideoPlayer';
import { VideoFeedView, type FeedVideo } from '../pulse-upload/VideoFeedView';

/** What the Videos card says while a video is dragged over it. */
const DROP_VIDEO_TEXT = 'Drop a video to upload it here';

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
  // The video playing in the feed (null: closed).
  const [openVideo, setOpenVideo] = useState<string | null>(null);

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

  // Every row of a video, by its id however its URL was stored: it has one name.
  const renameVideo = useCallback((videoId: string, name: string | null) => {
    setAttachments((prev) =>
      prev.map((other) =>
        other.type === 'video' && pulseArtifactId(other.url) === videoId
          ? { ...other, name }
          : other,
      ),
    );
  }, []);

  // The list's videos, once each, for the feed.
  const feedVideos = useMemo(() => {
    const videos = new Map<string, FeedVideo>();
    for (const a of attachments) {
      const id = a.type === 'video' ? pulseArtifactId(a.url) : null;
      if (!id || videos.has(id)) continue;
      const mine = Boolean(currentUserId) && currentUserId === a.addedBy;
      videos.set(id, {
        id,
        name: a.name ?? null,
        renamable: a.canRename,
        onRemove: mine ? () => void handleRemove(a.id) : undefined,
      });
    }
    return [...videos.values()];
  }, [attachments, currentUserId, handleRemove]);

  // Held here (not inside the buttons) so the list can show the file on its
  // way up, in place, until it lands and the refetch brings its card.
  const pulse = usePulseUpload(
    { kind, id: entityId },
    { onSettled: (status) => status.state === 'done' && void fetchAttachments() },
  );
  const sending = pulse.file;
  // Dropping a video file anywhere on the card uploads it, as Upload does.
  const { upload } = pulse;
  const dropzone = useDropzone({
    onDrop: (files) => void (files[0] && upload(files[0])),
    accept: VIDEO_FILE_ACCEPT.split(','),
    multiple: false,
    disabled: Boolean(sending),
  });

  return (
    <section className="attachments-panel relative" {...dropzone.getRootProps()}>
      <DropzoneOverlay
        isVisible={dropzone.isDragging}
        message={DROP_VIDEO_TEXT}
        size="compact"
        variant="primary"
        className="rounded-xl"
      />
      {/* Wraps instead of squeezing: on a phone the chips drop under the
          heading. Top-aligned: a message that doesn't fit beside the chips
          drops under them, and the heading stays level with the chips. */}
      <div className="attachments-header mb-3 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        {showHeading && (
          <Text
            as="h3"
            size="sm"
            className="flex min-h-8 items-center gap-1.5 font-semibold text-neutral-700 dark:text-neutral-300"
          >
            <FontAwesomeIcon icon={faVideo} size="sm" aria-hidden />
            Videos
          </Text>
        )}
        <PulseControls
          pulse={pulse}
          ariaLabel="Add a video with Pulse"
          allowFile
          card={showHeading ? 'end' : 'start'}
        />
      </div>

      {loading && <Spinner size="sm" />}

      {!loading && attachments.length === 0 && !sending && (
        <Text size="xs" variant="muted">
          No videos yet.
        </Text>
      )}

      <ul className="attachment-list flex flex-col gap-1" aria-label="Videos">
        {attachments.map((a) => {
          // Same rule as the Huddle feed: a video that's a PulseVault artifact
          // is a card; anything else is a link.
          const videoId = a.type === 'video' ? pulseArtifactId(a.url) : null;
          const mine = Boolean(currentUserId) && currentUserId === a.addedBy;
          return (
            <li
              key={a.id}
              className="attachment-item flex items-center justify-between gap-2 text-sm"
            >
              {videoId ? (
                // Rename and Remove live on the card's own ⋯ menu, as on
                // every video card.
                <figure className="attachment-video min-w-0">
                  <PulseVideoPlayer
                    video={videoId}
                    title={videoLabel(a.name, videoId)}
                    caption={a.name}
                    renamable={a.canRename}
                    onRenamed={(name) => renameVideo(videoId, name)}
                    onRemove={mine ? () => void handleRemove(a.id) : undefined}
                    onOpen={() => setOpenVideo(videoId)}
                  />
                </figure>
              ) : (
                <>
                  {/* A link attached before links moved to the description
                      passes through resolveMediaUrl untouched; a backend path
                      is bound to the current origin. */}
                  <a
                    href={resolveMediaUrl(a.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="attachment-link min-w-0 truncate text-primary hover:underline"
                  >
                    {a.title ?? a.url}
                  </a>
                  {mine && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemove(a.id)}
                      isLoading={deletingId === a.id}
                      aria-label={`Remove ${a.title ?? a.url}`}
                    >
                      <FontAwesomeIcon icon={faTrash} className="text-destructive" aria-hidden />
                    </Button>
                  )}
                </>
              )}
            </li>
          );
        })}
        {sending && (
          // The video on its way up, in place and drawn like the card it
          // becomes: cancellable while its bytes go up; once they're in, it
          // lands here by itself.
          <li className="attachment-item attachment-sending">
            <PendingVideoCard
              file={sending}
              progress={pulse.progress ?? 1}
              processing={pulse.processing}
              onCancel={pulse.processing ? undefined : pulse.cancel}
            />
          </li>
        )}
      </ul>

      <VideoFeedView
        videos={feedVideos}
        openId={openVideo}
        onClose={() => setOpenVideo(null)}
        onRenamed={renameVideo}
      />
    </section>
  );
};
