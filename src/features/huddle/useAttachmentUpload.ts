/**
 * One upload path for everything the composer can attach — the Photo/Video/Doc
 * pickers and screenshots pasted or dropped straight into the editor — so all
 * of them report progress, surface failures, and hand back a {@link MediaItem}
 * identically.
 */
import { useCallback, useRef, useState } from 'react';
import { uploadMedia } from './api';
import { composerErrorMessage } from './composerErrors';
import type { MediaItem } from './types';

/**
 * Largest file accepted, matching the backend's own MAX_FILE_MB. Checked here
 * so an oversize pick fails instantly with a message naming the file, instead
 * of after however long it takes to push the bytes up and be rejected.
 */
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

const formatMb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;

interface UseAttachmentUploadOptions {
  onAttachmentAdd: (media: MediaItem) => void;
  /**
   * Called with the in-flight upload's completed fraction (0–1), then `null`
   * once it settles (success or failure).
   */
  onUploadProgress?: (fraction: number | null) => void;
  /**
   * Called with a human-readable reason an attachment didn't make it, and with
   * `null` when a fresh upload clears the last one.
   *
   * Reported to the host rather than held here for the same reason progress is:
   * a composer runs several instances of this hook (the pickers, paste/drop),
   * and one `role="alert"` region owned by the composer is what the user should
   * see — not one per source, and not an `alert()`. Pass a stable callback
   * (a `useState` setter is ideal); its identity feeds `upload`'s, which
   * MarkdownEditor uses to decide whether to re-register its native listeners.
   */
  onError?: (message: string | null) => void;
}

export function useAttachmentUpload({
  onAttachmentAdd,
  onUploadProgress,
  onError,
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
      onError?.(null);

      const oversize = files.filter((file) => file.size > MAX_ATTACHMENT_BYTES);
      if (oversize.length > 0) {
        onError?.(
          `${oversize.map((f) => f.name).join(', ')} — too large to attach ` +
            `(limit ${formatMb(MAX_ATTACHMENT_BYTES)}).`,
        );
      }
      const accepted = files.filter((file) => file.size <= MAX_ATTACHMENT_BYTES);
      if (accepted.length === 0) return;

      setUploading(true);
      onUploadProgress?.(0);

      const totalBytes = accepted.reduce((sum, file) => sum + file.size, 0) || 1;
      const sentBytes = new Array<number>(accepted.length).fill(0);
      const reportProgress = () => {
        const sent = sentBytes.reduce((sum, bytes) => sum + bytes, 0);
        onUploadProgress?.(Math.min(1, sent / totalBytes));
      };

      const results = await Promise.allSettled(
        accepted.map((file, index) =>
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
      const failures: Array<{ name: string; reason: unknown }> = [];
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') onAttachmentAdd(result.value);
        else failures.push({ name: accepted[index].name, reason: result.reason });
      });

      if (failures.length > 0) {
        console.error('[useAttachmentUpload] Upload failed:', failures);
        // Named, because a partial batch is the confusing case: three files go
        // in, two chips come out, and without the name there is no telling
        // which one is missing.
        const [first] = failures;
        const reason = composerErrorMessage(first.reason, 'Upload failed. Please try again.');
        const others =
          failures.length > 1 ? ` (and ${failures.length - 1} more didn't attach)` : '';
        onError?.(`${first.name} — ${reason}${others}`);
      }
    },
    [onAttachmentAdd, onUploadProgress, onError],
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
