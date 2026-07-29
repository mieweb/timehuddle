import { faQrcode, faVideo } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import * as tus from 'tus-js-client';
import React, { useEffect, useRef, useState } from 'react';

import { mediaApi, videoApi, METEOR_BASE_URL } from '../../lib/api';
import { getStoreOS, isNativeApp, openNativePulseOrStore, openPulseAppOrStore } from '../../lib/device';
import type { MediaItem } from './types';
import { buildUploadDeepLink } from '../media/PulseUploadButton';
import { PulseUploadModal } from '../media/PulseUploadModal';

interface PulseAttachButtonProps {
  /** Called with the recorded/uploaded video as a composer attachment. */
  onAttach: (media: MediaItem) => void;
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
 * by `videoid`, so the QR/phone flow is detected by polling `media.list` for the
 * reserved id (there's no ticket attachment list to watch).
 */
export const PulseAttachButton: React.FC<PulseAttachButtonProps> = ({ onAttach }) => {
  const isNative = isNativeApp();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [uploadLink, setUploadLink] = useState<string | null>(null);
  const [videoid, setVideoid] = useState<string | null>(null);
  const [uploadToken, setUploadToken] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reserving, setReserving] = useState(false);

  // Poll the media library while the QR modal is open to detect a phone upload
  // of the reserved videoid.
  useEffect(() => {
    if (!modalOpen || !videoid) return;
    const interval = setInterval(async () => {
      try {
        const items = await mediaApi.list();
        const match = items.find((m) => m.videoid === videoid || m.id === videoid);
        if (match) {
          clearInterval(interval);
          setModalOpen(false);
          onAttach(videoMediaItem(videoid, match.filename ?? `${videoid}.mp4`, match.size ?? 0));
        }
      } catch {
        // ignore transient polling errors
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [modalOpen, videoid, onAttach]);

  const doReserve = async (): Promise<{ videoid: string; uploadLink: string } | null> => {
    setReserving(true);
    setError(null);
    try {
      const { videoid, uploadToken } = await videoApi.reserveForLibrary();
      const link = buildUploadDeepLink(videoid, uploadToken);
      setVideoid(videoid);
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
        onAttach(videoMediaItem(videoid, file.name, file.size));
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
