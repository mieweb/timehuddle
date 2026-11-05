/**
 * One upload path for everything a composer can attach — the Photo/Video/Doc
 * pickers and screenshots pasted or dropped straight into the editor: each
 * file is staged as a tile and uploads in place at once (`useAttachmentUploads`
 * from `@mieweb/ui`, the lifecycle Huddle's message box runs too), removing it
 * takes the upload back, and posting waits for whatever is still uploading.
 */
import { useAttachmentUploads, type AttachmentUpload, type AttachmentUploads } from '@mieweb/ui';
import { useCallback, useMemo } from 'react';
import { isVideoFile, MAX_VIDEO_BYTES } from '../pulse-upload/videoFile';
import { discardMedia, uploadMedia } from './api';
import type { MediaItem } from './types';

/**
 * Largest photo or document accepted, matching the backend's own MAX_FILE_MB.
 * A video goes to PulseVault instead, which takes up to {@link MAX_VIDEO_BYTES}.
 * Checked before upload so an oversize pick fails instantly with a message
 * naming the file, instead of after however long it takes to push the bytes up
 * and be rejected.
 */
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

/** Largest this file may be to attach: every composer's cap, Clock's and Huddle's. */
export const attachmentSizeLimit = (file: File) =>
  isVideoFile(file) ? MAX_VIDEO_BYTES : MAX_ATTACHMENT_BYTES;

/** {@link attachmentSizeLimit} as the refusals say it: "500 MB". */
export const attachmentLimitLabel = (file: File) =>
  `${Math.round(attachmentSizeLimit(file) / 1048576)} MB`;

/** A composer's staged files, plus `attach`: add files, turning away oversize ones. */
export interface ComposerUploads extends AttachmentUploads<MediaItem> {
  /** Stages and uploads `files`, turning away oversize ones; returns what was staged. */
  attach: (files: File[]) => AttachmentUpload<MediaItem>[];
}

/** Uploads a staged file: photos and documents to the media library, videos to PulseVault. */
export const uploadAttachment = (
  file: File,
  { signal, onProgress }: { signal: AbortSignal; onProgress: (fraction: number) => void },
) => uploadMedia(file, onProgress, signal);

/**
 * The files a composer attached, each uploading as soon as it's added. `attach`
 * turns away a file over its size limit with a message naming it (`onError`),
 * and clears the last message when a fresh pick goes up. Removing a file
 * aborts its upload, or takes a finished one back (discardMedia).
 */
export function useComposerUploads({
  onError,
}: {
  /** The reason a pick didn't attach, or null when a fresh pick clears it. */
  onError?: (message: string | null) => void;
} = {}): ComposerUploads {
  const uploads = useAttachmentUploads<MediaItem>({
    upload: uploadAttachment,
    discard: discardMedia,
  });
  const { add } = uploads;
  const attach = useCallback(
    (files: File[]) => {
      if (files.length === 0) return [];
      onError?.(null);
      const oversize = files.filter((file) => file.size > attachmentSizeLimit(file));
      if (oversize.length > 0) {
        onError?.(
          oversize
            .map((f) => `${f.name} — too large to attach (limit ${attachmentLimitLabel(f)}).`)
            .join(' '),
        );
      }
      return add(files.filter((file) => file.size <= attachmentSizeLimit(file)));
    },
    [add, onError],
  );
  return useMemo(() => ({ ...uploads, attach }), [uploads, attach]);
}
