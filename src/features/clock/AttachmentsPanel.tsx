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
import {
  Button,
  DropzoneOverlay,
  Spinner,
  Text,
  UploadAnnouncer,
  useAttachmentUploads,
  useDropzone,
} from '@mieweb/ui';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  attachmentApi,
  resolveMediaUrl,
  type AttachmentKind,
  type Attachment,
} from '../../lib/api';
import { pulseArtifactId, videoLabel } from '../pulse-upload/artifact';
import { PendingVideoCard } from '../pulse-upload/PendingVideoCard';
import { PulseControls } from '../pulse-upload/PulseButton';
import { VIDEO_FILE_ACCEPT, uploadVideoTo, videoFileProblem } from '../pulse-upload/videoFile';
import { UPLOAD_TEXT } from '../huddle/uploadText';
import { usePulseUpload } from '../pulse-upload/usePulseUpload';
import { PulseVideoPlayer } from '../pulse-upload/PulseVideoPlayer';
import { VideoFeedView, type FeedVideo } from '../pulse-upload/VideoFeedView';

interface AttachmentsPanelProps {
  kind: AttachmentKind;
  entityId: string;
  currentUserId?: string;
  /** False where the host already names the section (a "Session videos" window). */
  showHeading?: boolean;
}

/** When a landed video is looked for in the list again, about 37 s in all. */
const LIST_RETRY_MS = [0, 2_000, 5_000, 10_000, 20_000];

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

  // Only the newest fetch lands: two videos landing close together each
  // fetch, and an older answer must not replace a newer one.
  const fetchSeq = useRef(0);
  const fetchAttachments = useCallback(async () => {
    const seq = ++fetchSeq.current;
    setLoading(true);
    try {
      const data = await attachmentApi.list(kind, entityId);
      if (seq === fetchSeq.current) setAttachments(data);
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

  // Pulse (the phone app): its own link, never held up by a file upload here.
  const pulse = usePulseUpload(
    { kind, id: entityId },
    { onSettled: (status) => status.state === 'done' && void fetchAttachments() },
  );

  // Video files from this device: each uploads at once, shown in place as a
  // pending card, several at a time. The server attaches each one when it
  // lands, so an upload keeps going if the page is left, and a landed one
  // makes way for its card once that's in the list.
  const fileUploads = useAttachmentUploads<string>({
    upload: (file, { signal, onProgress }) =>
      uploadVideoTo({ kind, id: entityId }, file, onProgress, signal),
    keepUploadingOnUnmount: true,
  });
  const { add, remove: removeFile } = fileUploads;
  // A file that isn't a video, or is too large, is turned away with the
  // reason, as the composers do — not left as a card whose Retry can't work.
  const [fileError, setFileError] = useState<string | null>(null);
  const addFiles = useCallback(
    (files: File[]) => {
      const refused = files
        .map((file) => {
          const problem = videoFileProblem(file);
          return problem && `${file.name}: ${problem}`;
        })
        .filter(Boolean);
      setFileError(refused.length ? refused.join(' ') : null);
      add(files.filter((file) => !videoFileProblem(file)));
    },
    [add],
  );
  const listedVideos = useMemo(
    () => new Set(attachments.map((a) => (a.type === 'video' ? pulseArtifactId(a.url) : null))),
    [attachments],
  );
  // A landed video is looked for in the list a few times (a refresh can fail
  // or come back early); if it still isn't there, its card says so instead of
  // staying on Processing with nothing to press.
  const listChecks = useRef(
    new Map<string, { tries: number; timer?: ReturnType<typeof setTimeout> }>(),
  );
  const [listChecked, setListChecked] = useState(0);
  useEffect(() => {
    for (const item of fileUploads.items) {
      if (item.state !== 'uploaded') continue;
      const check = listChecks.current.get(item.id) ?? { tries: 0 };
      if (listedVideos.has(item.result ?? null)) {
        clearTimeout(check.timer);
        listChecks.current.delete(item.id);
        removeFile(item.id);
        continue;
      }
      if (check.timer) continue;
      if (check.tries >= LIST_RETRY_MS.length) {
        listChecks.current.delete(item.id);
        removeFile(item.id);
        setFileError(UPLOAD_TEXT.notListed(item.file.name));
        continue;
      }
      check.timer = setTimeout(() => {
        check.timer = undefined;
        void fetchAttachments().finally(() => setListChecked((n) => n + 1));
      }, LIST_RETRY_MS[check.tries]);
      check.tries += 1;
      listChecks.current.set(item.id, check);
    }
  }, [fileUploads.items, listedVideos, fetchAttachments, removeFile, listChecked]);
  useEffect(() => {
    const checks = listChecks.current;
    return () => checks.forEach((check) => clearTimeout(check.timer));
  }, []);
  // Landed but not in the list yet: still shown, as Processing.
  const pending = fileUploads.items;

  // Dropping video files anywhere on the card uploads them, as Upload does.
  const dropzone = useDropzone({
    onDrop: (files) => addFiles(files),
    accept: VIDEO_FILE_ACCEPT.split(','),
    multiple: true,
  });

  return (
    <section className="attachments-panel relative" {...dropzone.getRootProps()}>
      <DropzoneOverlay
        isVisible={dropzone.isDragging}
        message={UPLOAD_TEXT.dropVideos}
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
          onFiles={addFiles}
          ariaLabel="Add a video with Pulse"
          allowFile
          card={showHeading ? 'end' : 'start'}
        />
      </div>

      {/* Said as videos upload; a file turned away says why. */}
      <UploadAnnouncer items={fileUploads.items} labels={UPLOAD_TEXT} />
      <div role="alert" className="attachments-file-error">
        {fileError && (
          <Text size="xs" variant="destructive" className="mb-2">
            {fileError}
          </Text>
        )}
      </div>

      {loading && <Spinner size="sm" />}

      {!loading && attachments.length === 0 && pending.length === 0 && (
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
        {pending.map((upload) => (
          // A video on its way up, in place and drawn like the card it becomes.
          <li key={upload.id} className="attachment-item attachment-sending">
            <PendingVideoCard
              upload={upload}
              onRemove={() => removeFile(upload.id)}
              onRetry={() => fileUploads.retry(upload.id)}
            />
          </li>
        ))}
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
