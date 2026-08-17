/**
 * One upload path for everything the composer can attach — the Photo/Video/Doc
 * pickers and screenshots pasted straight into the editor — so both report
 * progress, surface failures, and hand back a {@link MediaItem} identically.
 */
import { useCallback, useState } from 'react';
import { uploadMedia } from './api';
import type { MediaItem } from './types';

interface UseAttachmentUploadOptions {
  onAttachmentAdd: (media: MediaItem) => void;
  /**
   * Called with the in-flight upload's completed fraction (0–1), then `null`
   * once it settles (success or failure).
   */
  onUploadProgress?: (fraction: number | null) => void;
}

export function useAttachmentUpload({
  onAttachmentAdd,
  onUploadProgress,
}: UseAttachmentUploadOptions) {
  const [uploading, setUploading] = useState(false);

  /** Uploads sequentially, so the shared progress bar tracks one file at a time. */
  const upload = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        setUploading(true);
        onUploadProgress?.(0);
        try {
          const media = await uploadMedia(file, (fraction) => onUploadProgress?.(fraction));
          onAttachmentAdd(media);
        } catch (error) {
          console.error('[useAttachmentUpload] Upload failed:', error);
          alert(error instanceof Error ? error.message : 'Upload failed. Please try again.');
        } finally {
          setUploading(false);
          onUploadProgress?.(null);
        }
      }
    },
    [onAttachmentAdd, onUploadProgress],
  );

  return { upload, uploading };
}
