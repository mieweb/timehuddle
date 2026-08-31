import { faQrcode, faVideo } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import * as tus from 'tus-js-client';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { mediaApi, videoApi } from '../../lib/api';
import {
  getStoreOS,
  isNativeApp,
  openNativePulseOrStore,
  openPulseAppOrStore,
} from '../../lib/device';
import type { MediaItem } from './types';
import { buildScanLink, buildUploadDeepLink } from '../media/PulseUploadButton';
import { PulseUploadModal } from '../media/PulseUploadModal';
import {
  PENDING_TTL_MS,
  POLL_INTERVAL_MS,
  persistDone,
  readPending,
  videoMediaItem,
  writePending,
  clearComposerPulseUpload,
  type PendingUpload,
} from './pulseComposerUpload';

interface PulseAttachButtonProps {
  /** Called with the recorded/uploaded video as a composer attachment. */
  onAttach: (media: MediaItem) => void;
  /**
   * Identifies which composer this button belongs to, so a pending reservation
   * is resumed by that composer only (the feed composer must not swallow a
   * video recorded from an open edit composer). Also the localStorage key
   * suffix, so it has to be stable across remounts/reloads of the same composer.
   */
  scope?: string;
}

/**
 * Pulse video button for the Huddle composer — mirrors the ticket-details
 * {@link PulseUploadButton} (QR-record-with-phone + upload-from-device) but
 * reserves a *library* video (no ticket context) and hands the finished clip
 * back to the composer as an attachment.
 *
 * A library upload completing on the backend inserts a media-library item keyed
 * by `videoid`, so the phone/QR flow is detected by polling `media.list` for the
 * reserved id (there's no ticket attachment list to watch). Unlike the ticket
 * flow — where the backend attaches the video itself — nothing links the clip to
 * the composer server-side, so the watcher runs off a persisted reservation
 * rather than off the QR modal being open.
 */
export const PulseAttachButton: React.FC<PulseAttachButtonProps> = ({
  onAttach,
  scope = 'default',
}) => {
  const isNative = isNativeApp();

  const fileInputRef = useRef<HTMLInputElement>(null);
  // Keeps the poll interval off the render cycle — `onAttach` is redefined by
  // the host on every render, and depending on it would restart the timer
  // before it ever fires.
  const onAttachRef = useRef(onAttach);
  onAttachRef.current = onAttach;
  const attachedRef = useRef<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [scanLink, setScanLink] = useState<string | null>(null);
  const [uploadToken, setUploadToken] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reserving, setReserving] = useState(false);
  const [pending, setPending] = useState<PendingUpload | null>(() => readPending(scope));

  const videoid = pending?.videoid ?? null;

  /** Hand the finished video to the composer exactly once. */
  const finishAttach = useCallback(
    (id: string, filename: string, size: number) => {
      if (attachedRef.current === id) return;
      attachedRef.current = id;
      const media = videoMediaItem(id, filename, size);
      // Keep the finished video persisted (not cleared) so a reload-remount can
      // restore it; the host clears it on post/cancel via clearComposerPulseUpload.
      persistDone(scope, id, media);
      setPending({ videoid: id, reservedAt: Date.now(), done: media });
      setModalOpen(false);
      setError(null);
      onAttachRef.current(media);
    },
    [scope],
  );

  // Re-attach a video that finished before a WebView reload wiped the composer
  // state (returning from the Pulse app remounts this button with the persisted
  // `done` record). attachedRef guards against a same-session double-emit.
  const doneEmittedRef = useRef(false);
  useEffect(() => {
    if (doneEmittedRef.current || !pending?.done) return;
    if (attachedRef.current === pending.videoid) return;
    doneEmittedRef.current = true;
    attachedRef.current = pending.videoid;
    onAttachRef.current(pending.done);
  }, [pending]);

  // Watch the media library for the reserved videoid until it appears. Runs
  // whether or not the QR modal is open, and survives the app being
  // backgrounded by the Pulse deep link (the reservation is in localStorage).
  useEffect(() => {
    if (!pending || pending.done) return;
    let cancelled = false;

    const check = async () => {
      if (cancelled || document.hidden) return;
      if (Date.now() - pending.reservedAt > PENDING_TTL_MS) {
        clearComposerPulseUpload(scope);
        setPending(null);
        return;
      }
      try {
        const items = await mediaApi.list();
        const match = items.find((m) => m.videoid === pending.videoid || m.id === pending.videoid);
        if (!match || cancelled) return;
        finishAttach(pending.videoid, match.filename ?? `${pending.videoid}.mp4`, match.size ?? 0);
      } catch {
        // ignore transient polling errors
      }
    };

    // Returning from the Pulse app fires a visibility change — check straight
    // away instead of waiting out the interval.
    const onVisible = () => {
      if (!document.hidden) void check();
    };

    void check();
    const interval = setInterval(() => void check(), POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [pending, scope, finishAttach]);

  const doReserve = async (): Promise<{ videoid: string; uploadLink: string } | null> => {
    setReserving(true);
    setError(null);
    try {
      const { videoid, uploadToken } = await videoApi.reserveForLibrary();
      const link = buildUploadDeepLink(videoid, uploadToken);
      attachedRef.current = null;
      setPending(writePending(scope, videoid));
      setUploadToken(uploadToken);
      setScanLink(buildScanLink(videoid, uploadToken));
      return { videoid, uploadLink: link };
    } catch {
      setError('Could not prepare upload. Try again.');
      return null;
    } finally {
      setReserving(false);
    }
  };

  const handleClick = async () => {
    const res = await doReserve();
    if (!res) return;

    const storeOS = getStoreOS();
    if (storeOS) {
      if (isNativeApp()) {
        await openNativePulseOrStore(res.uploadLink, storeOS);
      } else {
        openPulseAppOrStore(res.uploadLink, storeOS);
      }
      return;
    }

    // Desktop: show the QR modal.
    setModalOpen(true);
  };

  const handleCancelPending = () => {
    clearComposerPulseUpload(scope);
    setPending(null);
    setUploadToken(null);
    setScanLink(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !videoid || !uploadToken) return;

    setError(null);
    setProgress(0);

    const upload = new tus.Upload(file, {
      endpoint: videoApi.uploadEndpoint(),
      retryDelays: videoApi.uploadRetryDelays,
      onShouldRetry: videoApi.shouldRetryUpload,
      metadata: { filename: file.name, filetype: file.type, videoid },
      headers: { Authorization: `Bearer ${uploadToken}` },
      onProgress(bytesUploaded, bytesTotal) {
        setProgress(Math.round((bytesUploaded / bytesTotal) * 100));
      },
      onSuccess() {
        setUploadToken(null);
        setProgress(null);
        finishAttach(videoid, file.name, file.size);
      },
      async onError(err) {
        // The backend finalizes the upload the moment the first PATCH completes,
        // so a duplicate-PATCH 409 (or other late error) can fire even though the
        // video already landed. Mirror the ticket flow's server-authoritative
        // behavior: re-check the library before surfacing a failure. The pending
        // watcher stays running as a second safety net.
        setProgress(null);
        try {
          const items = await mediaApi.list();
          const match = items.find((m) => m.videoid === videoid || m.id === videoid);
          if (match) {
            setUploadToken(null);
            finishAttach(videoid, match.filename ?? file.name, match.size ?? file.size);
            return;
          }
        } catch {
          // fall through to surfacing the original error
        }
        setError(err instanceof Error ? err.message : 'Upload failed. Try again.');
      },
    });

    upload.start();
  };

  const handleUploadFromDevice = () => {
    setModalOpen(false);
    fileInputRef.current?.click();
  };

  const isUploading = progress !== null;
  const isWaiting = !!pending && !pending.done && !isUploading && !modalOpen;

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".mp4,video/mp4"
        className="hidden"
        aria-label="Select MP4 file to upload"
        onChange={handleFileChange}
        disabled={isUploading}
      />

      <button
        type="button"
        onClick={handleClick}
        disabled={isUploading || reserving}
        aria-label="Record or upload a video with Pulse"
        className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-neutral-400 border border-gray-200 dark:border-neutral-700 px-3 py-1.5 rounded-full hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <FontAwesomeIcon icon={isNative ? faVideo : faQrcode} className="w-3.5 h-3.5" />
        {reserving ? 'Preparing…' : isUploading ? `${progress}%` : 'Pulse'}
      </button>

      {isWaiting && (
        <span
          className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-neutral-400"
          role="status"
          aria-live="polite"
        >
          Waiting for your Pulse video…
          <button
            type="button"
            onClick={handleCancelPending}
            aria-label="Stop waiting for the Pulse video"
            className="underline hover:text-gray-700 dark:hover:text-neutral-200 transition-colors"
          >
            Cancel
          </button>
        </span>
      )}

      {error && (
        <span className="text-xs text-red-500 dark:text-red-400" role="alert">
          {error}
        </span>
      )}

      <PulseUploadModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        scanLink={scanLink}
        onUploadFromDevice={handleUploadFromDevice}
        onDone={() => setModalOpen(false)}
        doneLabel="Done"
      />
    </>
  );
};
