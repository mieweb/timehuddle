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

  /**
   * Uploads all files at once and reports one byte-weighted fraction across
   * them, so a batch of photos costs about as long as its largest file rather
   * than the sum of every file.
   */
  const upload = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setUploading(true);
      onUploadProgress?.(0);

      const totalBytes = files.reduce((sum, file) => sum + file.size, 0) || 1;
      const sentBytes = new Array<number>(files.length).fill(0);
      const reportProgress = () => {
        const sent = sentBytes.reduce((sum, bytes) => sum + bytes, 0);
        onUploadProgress?.(Math.min(1, sent / totalBytes));
      };

      const results = await Promise.allSettled(
        files.map((file, index) =>
          uploadMedia(file, (fraction) => {
            sentBytes[index] = fraction * file.size;
            reportProgress();
          }),
        ),
      );

      setUploading(false);
      onUploadProgress?.(null);

      // Added in pick order, not completion order, so the composer's attachment
      // strip matches what the user selected.
      const failures: unknown[] = [];
      for (const result of results) {
        if (result.status === 'fulfilled') onAttachmentAdd(result.value);
        else failures.push(result.reason);
      }

      if (failures.length > 0) {
        console.error('[useAttachmentUpload] Upload failed:', failures);
        const first = failures[0];
        alert(first instanceof Error ? first.message : 'Upload failed. Please try again.');
      }
    },
    [onAttachmentAdd, onUploadProgress],
  );

  return { upload, uploading };
}
