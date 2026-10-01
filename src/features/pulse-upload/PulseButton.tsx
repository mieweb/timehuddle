/**
 * PulseButton — the one way to add a video anywhere in TimeHuddle: a "Pulse"
 * pill that reserves an upload for a `destination`, then shows the QR code
 * (computer) or opens the Pulse app (phone).
 *
 * Pulse is "one link, one upload": the reservation says where the video goes,
 * and the server puts it there the moment it lands — a Huddle post, a plan
 * that clocks you in, a wrap-up that clocks you out, a ticket or session
 * attachment, a timesheet walkthrough (see pulse-destinations.js). So this
 * button holds no upload state of its own: nothing to persist, nothing to
 * attach. It only watches long enough to tell the person it worked, and calls
 * `onLanded` for hosts that show the result themselves (an attachment list).
 */
import { faVideo } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Text } from '@mieweb/ui';
import React, { useEffect, useRef, useState } from 'react';

import { videoApi, type PulseDestination, type PulseUploadStatus } from '../../lib/api';
import {
  getStoreOS,
  isNativeApp,
  openNativePulseOrStore,
  openPulseAppOrStore,
} from '../../lib/device';
import { ComposerChipButton } from '../huddle/ComposerChipButton';
import { buildScanLink, buildUploadDeepLink } from './pulseLinks';
import { keptMessage } from './pulseStatus';
import { PulseUploadModal } from './PulseUploadModal';

/** How often to ask whether the upload landed, while the page is visible. */
const STATUS_POLL_MS = 3000;
/** A Pulse link works for 30 minutes (UPLOAD_LINK_SECONDS on the server). */
const LINK_LIFETIME_MS = 30 * 60 * 1000;

/** The link this button handed out, and what it was for. */
interface PulseUpload {
  videoid: string;
  uploadToken: string;
  scanLink: string;
  /** When it was reserved; the link works for LINK_LIFETIME_MS from then. */
  at: number;
  /** The destination it was reserved for, as a comparable key. */
  destinationKey: string;
}

interface PulseButtonProps {
  destination: PulseDestination;
  /** What landing did, shown in the modal: "Posted", "Added", "Clocked in". */
  landedLabel?: string;
  /** Accessible name; the visible label is always "Pulse". */
  ariaLabel?: string;
  /** Called once the video has landed: delivered, or kept in the library. */
  onLanded?: () => void;
  disabled?: boolean;
}

export const PulseButton: React.FC<PulseButtonProps> = ({
  destination,
  landedLabel = 'Added',
  ariaLabel = 'Record a video with Pulse',
  onLanded,
  disabled,
}) => {
  const onLandedRef = useRef(onLanded);
  onLandedRef.current = onLanded;

  const [reserving, setReserving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upload, setUpload] = useState<PulseUpload | null>(null);
  const [status, setStatus] = useState<PulseUploadStatus>({ state: 'waiting' });
  const { state } = status;
  const [modalOpen, setModalOpen] = useState(false);

  // Watch the reserved upload until it lands or the link runs out: on a timer
  // while the page is visible (a phone often comes back from the Pulse app
  // before the upload finishes), and at once when it's shown again. The video
  // goes where it belongs either way; this is only to say so.
  useEffect(() => {
    if (!upload || state !== 'waiting') return;
    let cancelled = false;
    const check = async () => {
      if (cancelled || document.hidden) return;
      if (Date.now() - upload.at > LINK_LIFETIME_MS) {
        setStatus({ state: 'expired' });
        return;
      }
      try {
        const next = await videoApi.status(upload.videoid);
        if (cancelled || next.state === 'waiting') return;
        setStatus(next);
        if (next.state === 'done' || next.state === 'kept') onLandedRef.current?.();
      } catch {
        // transient: try again next tick
      }
    };
    const onVisible = () => {
      if (!document.hidden) void check();
    };
    const interval = setInterval(() => void check(), STATUS_POLL_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [upload, state]);

  // Once it has landed, let the modal show it for a moment, then close it.
  useEffect(() => {
    if (state !== 'done' || !modalOpen) return;
    const t = setTimeout(() => setModalOpen(false), 1500);
    return () => clearTimeout(t);
  }, [state, modalOpen]);

  // Phone: straight into the Pulse app (or its store listing). Computer: QR.
  const openLink = async ({ videoid, uploadToken }: PulseUpload) => {
    const storeOS = getStoreOS();
    const deepLink = buildUploadDeepLink(videoid, uploadToken);
    if (storeOS && isNativeApp()) await openNativePulseOrStore(deepLink, storeOS);
    else if (storeOS) openPulseAppOrStore(deepLink, storeOS);
    else setModalOpen(true);
  };

  const handleClick = async () => {
    // One link, one upload: while the last link is still live and waiting,
    // open it again rather than minting a second one that could also land.
    const destinationKey = JSON.stringify(destination);
    const live =
      upload &&
      state === 'waiting' &&
      upload.destinationKey === destinationKey &&
      Date.now() - upload.at < LINK_LIFETIME_MS;
    if (live) {
      await openLink(upload);
      return;
    }

    setReserving(true);
    setError(null);
    let reservation: { videoid: string; uploadToken: string };
    try {
      reservation = await videoApi.reserve(destination);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Could not start Pulse. Try again.');
      return;
    } finally {
      setReserving(false);
    }

    const { videoid, uploadToken } = reservation;
    const next: PulseUpload = {
      videoid,
      uploadToken,
      scanLink: buildScanLink(videoid, uploadToken),
      at: Date.now(),
      destinationKey,
    };
    setUpload(next);
    setStatus({ state: 'waiting' });
    await openLink(next);
  };

  return (
    <>
      <ComposerChipButton
        onClick={handleClick}
        disabled={disabled || reserving}
        aria-label={ariaLabel}
        aria-busy={reserving}
        leftIcon={<FontAwesomeIcon icon={faVideo} className="w-3.5 h-3.5" aria-hidden="true" />}
      >
        {reserving ? 'Preparing…' : 'Pulse'}
      </ComposerChipButton>

      {error && (
        <Text as="span" size="xs" className="text-red-500 dark:text-red-400" role="alert">
          {error}
        </Text>
      )}
      {/* Phones have no modal: say it here when the video went elsewhere. */}
      {state === 'kept' && !modalOpen && (
        <Text as="span" size="xs" variant="muted" role="status">
          {keptMessage(status.reason)}
        </Text>
      )}

      <PulseUploadModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        scanLink={upload?.scanLink ?? null}
        status={status}
        landedLabel={landedLabel}
      />
    </>
  );
};
