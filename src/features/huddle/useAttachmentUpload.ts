/**
 * One upload path for everything the composer can attach — the Photo/Video/Doc
 * pickers and screenshots pasted straight into the editor — so both report
 * progress, surface failures, and hand back a {@link MediaItem} identically.
 */
import { useCallback, useRef, useState } from 'react';
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

/** Independent upload sources within one composer. */
export type UploadProgressSource = 'picker' | 'paste';

/**
 * One progress fraction across every upload source in a composer.
 *
 * The file pickers and pasted screenshots each own their own {@link
 * useAttachmentUpload} instance, and a paste can start while a picker upload is
 * still on the wire. Reporting straight to the composer let whichever settled
 * first clear the bar and re-enable Post, dropping the attachment still in
 * flight — so every source reports here instead, and the composer only reads
 * idle once all of them have settled.
 */
export function useUploadProgress() {
  const [fraction, setFraction] = useState<number | null>(null);
  // Latest fraction per in-flight source; a source is removed when it settles.
  const activeRef = useRef(new Map<UploadProgressSource, number>());
  // Reporters are cached so each source keeps one stable callback identity —
  // the paste reporter flows into a memoized handler whose identity decides
  // whether MarkdownEditor re-registers its native paste listener.
  const reportersRef = useRef(new Map<UploadProgressSource, (value: number | null) => void>());

  const reporterFor = useCallback((source: UploadProgressSource) => {
    const cached = reportersRef.current.get(source);
    if (cached) return cached;

    const reporter = (value: number | null) => {
      const active = activeRef.current;
      if (value === null) active.delete(source);
      else active.set(source, value);
      // The least-complete source drives the bar: byte weighting across sources
      // isn't available here, and taking the max would jump the bar to nearly
      // done while a second upload had barely started.
      setFraction(active.size === 0 ? null : Math.min(...active.values()));
    };

    reportersRef.current.set(source, reporter);
    return reporter;
  }, []);

  return { fraction, reporterFor };
}
