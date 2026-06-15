import { faQrcode, faVideo, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Button,
  Modal,
  ModalBody,
  ModalClose,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Text,
} from '@mieweb/ui';
import { Capacitor } from '@capacitor/core';
import { QRCodeSVG } from 'qrcode.react';
import * as tus from 'tus-js-client';
import React, { useEffect, useRef, useState } from 'react';

import { attachmentApi, TIMECORE_BASE_URL, videoApi } from '../../lib/api';

/**
 * The Pulse Cam server base for deep links.
 * Points at the API root so Pulse Cam uses the unauthenticated compat TUS
 * path (/reserve, /upload) — Pulse Cam has no session token to authenticate
 * with the versioned /v1/video path.
 */
export function pulseServerBase(): string {
  return TIMECORE_BASE_URL.replace(/\/$/, '');
}

/** Build the pulsecam:// deep link entirely client-side from the configured backend URL. */
function buildUploadDeepLink(videoid: string): string {
  const params = new URLSearchParams({ mode: 'upload', videoid, server: pulseServerBase() });
  return `pulsecam://?${params.toString()}`;
}

// ─── Per-ticket videoid persistence ──────────────────────────────────────────
// Persisting the videoid in localStorage means that if the user closes PulseCam
// before uploading and then reopens it from the same ticket, the exact same
// videoid (and therefore the same PulseCam session with its recorded segments)
// is reused rather than starting fresh.

const PULSEVAULT_STORAGE_PREFIX = 'pulsevault:ticket:';

function getStoredVideoid(ticketId: string): string | null {
  try {
    return localStorage.getItem(`${PULSEVAULT_STORAGE_PREFIX}${ticketId}`);
  } catch {
    return null;
  }
}

function setStoredVideoid(ticketId: string, videoid: string): void {
  try {
    localStorage.setItem(`${PULSEVAULT_STORAGE_PREFIX}${ticketId}`, videoid);
  } catch {
    // localStorage may be unavailable in some native contexts — degrade gracefully.
  }
}

function clearStoredVideoid(ticketId: string): void {
  try {
    localStorage.removeItem(`${PULSEVAULT_STORAGE_PREFIX}${ticketId}`);
  } catch {
    // ignore
  }
}

interface PulseUploadButtonProps {
  ticketId: string;
  onUploadComplete: () => void;
}

export const PulseUploadButton: React.FC<PulseUploadButtonProps> = ({
  ticketId,
  onUploadComplete,
}) => {
  const isNative = Capacitor.isNativePlatform();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const knownAttachmentIds = useRef<Set<string>>(new Set());

  const [modalOpen, setModalOpen] = useState(false);
  const [uploadLink, setUploadLink] = useState<string | null>(null);
  const [videoid, setVideoid] = useState<string | null>(null);
  const [uploadToken, setUploadToken] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reserving, setReserving] = useState(false);

  // Poll every 3 s while QR modal is open to detect uploads from the phone.
  useEffect(() => {
    if (!modalOpen) return;
    const interval = setInterval(async () => {
      try {
        const attachments = await attachmentApi.list('ticket', ticketId);
        const hasNew = attachments.some(
          (a) => a.type === 'video' && !knownAttachmentIds.current.has(a.id),
        );
        if (hasNew) {
          clearInterval(interval);
          clearStoredVideoid(ticketId);
          setModalOpen(false);
          onUploadComplete();
        }
      } catch {
        // ignore transient polling errors
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [modalOpen, ticketId, onUploadComplete]);

  const doReserve = async (): Promise<{ videoid: string; uploadLink: string } | null> => {
    setReserving(true);
    setError(null);
    try {
      // Re-use any videoid already stored for this ticket so PulseCam can resume
      // a recording session that was interrupted before uploading.
      const existingVideoid = getStoredVideoid(ticketId) ?? undefined;
      const { videoid, uploadToken } = await videoApi.reserve(ticketId, existingVideoid);
      setStoredVideoid(ticketId, videoid);
      // Build deep link client-side so it always uses TIMECORE_BASE_URL
      // (the same URL the Capacitor app already talks to).
      const link = buildUploadDeepLink(videoid);
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

    if (isNative) {
      // On native Capacitor: open the Pulse deep link directly.
      // Pulse is sideloaded via EAS — must be installed first.
      window.open(res.uploadLink, '_system');
    } else {
      // On web: seed known attachment IDs, then show QR modal.
      try {
        const existing = await attachmentApi.list('ticket', ticketId);
        knownAttachmentIds.current = new Set(existing.map((a) => a.id));
      } catch {
        knownAttachmentIds.current = new Set();
      }
      setModalOpen(true);
    }
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
        clearStoredVideoid(ticketId);
        setUploadToken(null);
        setProgress(null);
        onUploadComplete();
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
    <div className="video-upload-wrapper mt-2">
      {/* Hidden file input for direct device uploads */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".mp4,video/mp4"
        className="hidden"
        aria-label="Select MP4 file to upload"
        onChange={handleFileChange}
        disabled={isUploading}
      />

      <Button
        size="sm"
        variant="secondary"
        disabled={isUploading || reserving}
        onClick={handleClick}
        aria-label="Upload video to this ticket"
        className="px-2 py-0.5 text-xs"
      >
        <FontAwesomeIcon icon={isNative ? faVideo : faQrcode} />
        {reserving ? 'Preparing…' : isUploading ? `${progress}%` : 'Upload video with Pulse'}
      </Button>

      {/* Device upload progress bar */}
      {isUploading && (
        <div
          className="video-upload-progress mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={progress ?? 0}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Upload progress: ${progress}%`}
        >
          <div
            className="h-full rounded-full bg-primary transition-all duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {error && (
        <Text size="xs" className="mt-1 text-destructive" role="alert">
          {error}
        </Text>
      )}

      {/* Web QR modal */}
      <Modal
        open={modalOpen}
        onOpenChange={(open) => !open && setModalOpen(false)}
        aria-label="Upload video with the Pulse app"
      >
        <ModalHeader>
          <ModalTitle>
            <span className="flex items-center gap-2">
              <FontAwesomeIcon icon={faQrcode} />
              Upload Video with Pulse
            </span>
          </ModalTitle>
          <ModalClose />
        </ModalHeader>

        <ModalBody>
          <div className="video-upload-modal-body flex flex-col items-center gap-4 py-2">
            {uploadLink && (
              <div className="video-upload-qr-container rounded-lg border border-border bg-white p-4">
                <QRCodeSVG
                  value={uploadLink}
                  size={200}
                  aria-label="QR code to open the Pulse upload screen"
                />
              </div>
            )}

            <Text size="sm" className="max-w-xs text-center text-muted-foreground">
              Scan with the <strong className="text-foreground">Pulse app</strong> on your phone.
              The attachment will appear automatically once the upload completes.
            </Text>

            <div className="video-upload-divider flex w-full items-center gap-3">
              <hr className="flex-1 border-border" />
              <Text size="xs" className="text-muted-foreground">
                or
              </Text>
              <hr className="flex-1 border-border" />
            </div>

            <Button
              size="sm"
              variant="outline"
              onClick={handleUploadFromDevice}
              aria-label="Upload video from this device instead"
            >
              <FontAwesomeIcon icon={faVideo} className="mr-1.5" />
              Upload from this device
            </Button>
          </div>
        </ModalBody>

        <ModalFooter>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setModalOpen(false)}
            aria-label="Close without uploading"
          >
            <FontAwesomeIcon icon={faXmark} className="mr-1.5" />
            Close
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setModalOpen(false);
              onUploadComplete();
            }}
            aria-label="I have uploaded — refresh the attachment list"
          >
            Done — Refresh
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
};
