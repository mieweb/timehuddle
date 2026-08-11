import { faQrcode, faVideo } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import * as tus from 'tus-js-client';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { mediaApi, videoApi, METEOR_BASE_URL } from '../../lib/api';
import {
  getStoreOS,
  isNativeApp,
  openNativePulseOrStore,
  openPulseAppOrStore,
} from '../../lib/device';
import type { MediaItem } from './types';
import { buildUploadDeepLink } from '../media/PulseUploadButton';
import { PulseUploadModal } from '../media/PulseUploadModal';

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

// ─── Pending reservation persistence ─────────────────────────────────────────
// A library reservation is only linked to the composer in client state, so
// anything that tears that state down between "reserve" and "upload finished"
// loses the video: on mobile the Pulse deep link backgrounds (and can reload)
// the app, and on desktop closing the QR modal used to stop the watcher. Both
// are the normal flow, so the pending videoid is persisted and watched until
// the media-library item shows up.

const PENDING_STORAGE_PREFIX = 'pulsevault:composer:';
/** Give a recording session plenty of time, but don't poll forever. */
const PENDING_TTL_MS = 30 * 60 * 1000;
const POLL_INTERVAL_MS = 4000;

interface PendingUpload {
  videoid: string;
  reservedAt: number;
}

function pendingKey(scope: string): string {
  return `${PENDING_STORAGE_PREFIX}${scope}`;
}

function readPending(scope: string): PendingUpload | null {
  try {
    const raw = localStorage.getItem(pendingKey(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingUpload;
    if (!parsed?.videoid || Date.now() - parsed.reservedAt > PENDING_TTL_MS) {
      localStorage.removeItem(pendingKey(scope));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writePending(scope: string, videoid: string): PendingUpload {
  const pending: PendingUpload = { videoid, reservedAt: Date.now() };
  try {
    localStorage.setItem(pendingKey(scope), JSON.stringify(pending));
  } catch {
    // localStorage may be unavailable in some native contexts — the in-memory
    // watcher still covers the same-session case.
  }
  return pending;
}

function clearPending(scope: string): void {
  try {
    localStorage.removeItem(pendingKey(scope));
  } catch {
    // ignore
  }
}

/** Build a composer MediaItem for a finished PulseVault video. */
function videoMediaItem(videoid: string, filename: string, size: number): MediaItem {
  return {
    id: videoid,
    type: 'video',
    size,
    mimeType: 'video/mp4',
    url: `${METEOR_BASE_URL.replace(/\/$/, '')}/pulsevault/artifacts/${videoid}`,
    filename,
  };
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
  const [uploadLink, setUploadLink] = useState<string | null>(null);
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
      clearPending(scope);
      setPending(null);
      setModalOpen(false);
      onAttachRef.current(videoMediaItem(id, filename, size));
    },
    [scope],
  );

  // Watch the media library for the reserved videoid until it appears. Runs
  // whether or not the QR modal is open, and survives the app being
  // backgrounded by the Pulse deep link (the reservation is in localStorage).
  useEffect(() => {
    if (!pending) return;
    let cancelled = false;

    const check = async () => {
      if (cancelled || document.hidden) return;
      if (Date.now() - pending.reservedAt > PENDING_TTL_MS) {
        clearPending(scope);
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
      setUploadLink(link);
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
    clearPending(scope);
    setPending(null);
    setUploadToken(null);
    setUploadLink(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !videoid || !uploadToken) return;

    setError(null);
    setProgress(0);

    const upload = new tus.Upload(file, {
      endpoint: videoApi.uploadEndpoint(),
      retryDelays: [0, 3000, 5000, 10000],
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
      onError(err) {
        setError(err instanceof Error ? err.message : 'Upload failed. Try again.');
        setProgress(null);
      },
    });

    upload.start();
  };

  const handleUploadFromDevice = () => {
    setModalOpen(false);
    fileInputRef.current?.click();
  };

  const isUploading = progress !== null;
  const isWaiting = !!pending && !isUploading && !modalOpen;

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
        uploadLink={uploadLink}
        onUploadFromDevice={handleUploadFromDevice}
        onDone={() => setModalOpen(false)}
        doneLabel="Done"
      />
    </>
  );
};
