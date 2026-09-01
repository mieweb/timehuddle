/**
 * One upload-progress fraction for a composer that has several independent
 * upload sources.
 *
 * The file pickers ({@link AttachmentBar}) and pasted screenshots each own a
 * separate {@link useAttachmentUpload} instance, and a paste can start while a
 * picker upload is still on the wire. When both reported straight to the
 * composer, whichever settled first cleared the bar and re-enabled Post — so
 * the user could submit while the other attachment was still uploading and lose
 * it. Every source reports here instead, and the composer only reads idle once
 * all of them have settled.
 */
import { useCallback, useRef, useState } from 'react';

export type UploadProgressSource = 'picker' | 'paste';

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
