import { faQrcode, faVideo } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Text } from '@mieweb/ui';
import * as tus from 'tus-js-client';
import React, { useEffect, useRef, useState } from 'react';

import {
  attachmentApi,
  TIMECORE_BASE_URL,
  videoApi,
  type TicketAttachmentKind,
} from '../../lib/api';
import {
  getStoreOS,
  isNativeApp,
  openNativePulseOrStore,
  openPulseAppOrStore,
} from '../../lib/device';
import { PulseUploadModal } from './PulseUploadModal';

/**
 * The Pulse Cam server base for deep links — origin plus the `/pulsevault`
 * mount prefix, per @mieweb/pulsevault's `buildUploadLink` `server` contract
 * (the client builds every request as `${server}/<path>` with no separate
 * prefix concept of its own).
 */
export function pulseServerBase(): string {
  return `${TIMECORE_BASE_URL.replace(/\/$/, '')}/pulsevault`;
}

/**
 * Build the pulsecam:// deep link entirely client-side. Mirrors
 * @mieweb/pulsevault's `buildUploadLink` protocol (PROTOCOL.md): `v=1`,
 * `artifactId`, `server`, and `token` (the capability token authorizing the
 * upload).
 */
export function buildUploadDeepLink(videoid: string, uploadToken: string): string {
  return `pulsecam://?${uploadParams(videoid, uploadToken).toString()}`;
}

/**
 * Build the https URL to encode in the QR code. Phone camera apps ignore a raw
 * `pulsecam://` QR when Pulse Cam isn't installed — the scan simply does
 * nothing. Pointing the QR at the backend's `/pulse/open` interstitial instead
 * means the phone lands on a page that opens Pulse Cam when it is installed and
 * offers the App Store / Play Store listing when it isn't.
 */
export function buildScanLink(videoid: string, uploadToken: string): string {
  const base = TIMECORE_BASE_URL.replace(/\/$/, '');
  return `${base}/pulse/open?${uploadParams(videoid, uploadToken).toString()}`;
}

function uploadParams(videoid: string, uploadToken: string): URLSearchParams {
  return new URLSearchParams({
    v: '1',
    artifactId: videoid,
    server: pulseServerBase(),
    token: uploadToken,
  });
}

// ─── Per-ticket videoid persistence ──────────────────────────────────────────
// Persisting the videoid in localStorage means that if the user closes PulseCam
// before uploading and then reopens it from the same ticket, the exact same
// videoid (and therefore the same PulseCam session with its recorded segments)
// is reused rather than starting fresh. Keyed by kind, so a Huddle ticket keeps
// its original `pulsevault:ticket:<id>` key and a Redmine issue gets its own.

function storageKey(kind: TicketAttachmentKind, ticketId: string): string {
  return `pulsevault:${kind}:${ticketId}`;
}

function getStoredVideoid(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setStoredVideoid(key: string, videoid: string): void {
  try {
    localStorage.setItem(key, videoid);
  } catch {
    // localStorage may be unavailable in some native contexts — degrade gracefully.
  }
}

function clearStoredVideoid(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

interface PulseUploadButtonProps {
  ticketId: string;
  /** What `ticketId` names: a Huddle ticket (default) or a Redmine issue. */
  kind?: TicketAttachmentKind;
  onUploadComplete: () => void;
}

export const PulseUploadButton: React.FC<PulseUploadButtonProps> = ({
  ticketId,
  kind = 'ticket',
  onUploadComplete,
}) => {
  const isNative = isNativeApp();
  const videoidKey = storageKey(kind, ticketId);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const knownAttachmentIds = useRef<Set<string>>(new Set());

  const [modalOpen, setModalOpen] = useState(false);
  const [scanLink, setScanLink] = useState<string | null>(null);
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
        const attachments = await attachmentApi.list(kind, ticketId);
        const hasNew = attachments.some(
          (a) => a.type === 'video' && !knownAttachmentIds.current.has(a.id),
        );
        if (hasNew) {
          clearInterval(interval);
          clearStoredVideoid(videoidKey);
          setModalOpen(false);
          onUploadComplete();
        }
      } catch {
        // ignore transient polling errors
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [modalOpen, kind, ticketId, videoidKey, onUploadComplete]);

  const doReserve = async (): Promise<{ videoid: string; uploadLink: string } | null> => {
    setReserving(true);
    setError(null);
    try {
      // Re-use any videoid already stored for this ticket so PulseCam can resume
      // a recording session that was interrupted before uploading.
      const existingVideoid = getStoredVideoid(videoidKey) ?? undefined;
      const { videoid, uploadToken } = await videoApi.reserve(ticketId, existingVideoid, kind);
      setStoredVideoid(videoidKey, videoid);
      // Build deep link client-side so it always uses TIMECORE_BASE_URL
      // (the same URL the Capacitor app already talks to).
      const link = buildUploadDeepLink(videoid, uploadToken);
      setVideoid(videoid);
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
        // Native: App.openUrl returns completed:false immediately when Pulse Cam
        // is not installed, giving us a reliable instant store redirect.
        await openNativePulseOrStore(res.uploadLink, storeOS);
      } else {
        // Mobile browser: visibility-change heuristic with ~1.5s fallback.
        openPulseAppOrStore(res.uploadLink, storeOS);
      }
      return;
    }

    // On desktop: seed known attachment IDs, then show QR modal.
    try {
      const existing = await attachmentApi.list(kind, ticketId);
      knownAttachmentIds.current = new Set(existing.map((a) => a.id));
    } catch {
      knownAttachmentIds.current = new Set();
    }
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
      retryDelays: videoApi.uploadRetryDelays,
      onShouldRetry: videoApi.shouldRetryUpload,
      metadata: { filename: file.name, filetype: file.type, videoid },
      headers: { Authorization: `Bearer ${uploadToken}` },
      onProgress(bytesUploaded, bytesTotal) {
        setProgress(Math.round((bytesUploaded / bytesTotal) * 100));
      },
      onSuccess() {
        // The attachment exists only once the backend has filed the video.
        void videoApi.waitUntilFiled(videoid, uploadToken).then((filed) => {
          setUploadToken(null);
          setProgress(null);
          if (filed.state === 'done') {
            clearStoredVideoid(videoidKey);
            onUploadComplete();
            return;
          }
          // The upload itself finished; only the filing didn't, or couldn't be
          // confirmed. Keep the stored videoid so a retry resumes the same one.
          setError(
            filed.state === 'kept'
              ? `Uploaded, but not attached: ${filed.reason ?? 'its destination is gone'}.`
              : filed.state === 'forbidden'
                ? 'Uploaded, but this link has expired. Refresh the ticket to see it.'
                : 'Uploaded; still being processed. Refresh the ticket in a minute.',
          );
        });
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
      <PulseUploadModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        scanLink={scanLink}
        onUploadFromDevice={handleUploadFromDevice}
        onDone={async () => {
          // The phone reports success when its last byte lands; the backend files the video
          // seconds later, after making it web-playable. Wait for that before closing (which
          // stops the attachment polling) and refreshing, or the ticket refreshes too early.
          if (!videoid || !uploadToken) {
            setModalOpen(false);
            onUploadComplete();
            return;
          }
          const filed = await videoApi.waitUntilFiled(videoid, uploadToken, 30_000);
          if (filed.state === 'done') {
            clearStoredVideoid(videoidKey);
            setModalOpen(false);
            onUploadComplete();
          } else if (filed.state === 'timeout') {
            // Still being made web-playable or filed: leave the modal open so the attachment
            // polling keeps watching, and say so.
            setError('Uploaded; still being processed. This will update when it lands.');
          } else {
            // The bytes landed but nothing was attached: say why, and keep the stored
            // videoid out of the way so the next attempt starts fresh.
            setModalOpen(false);
            setError(
              filed.state === 'kept'
                ? `Uploaded, but not attached: ${filed.reason ?? 'its destination is gone'}.`
                : 'Uploaded, but this link has expired. Refresh the ticket to see it.',
            );
          }
        }}
      />
    </div>
  );
};
