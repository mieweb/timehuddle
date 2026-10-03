/**
 * usePulseUpload — one Pulse link for one `destination`, from reserving it to
 * learning where the video ended up.
 *
 * Pulse is "one link, one upload": the reservation says where the video goes,
 * and the server puts it there the moment it lands (see
 * meteor-backend/server/pulse-destinations.js). This hook only hands out the
 * link (QR on a computer, the Pulse app on a phone) and watches long enough to
 * say what happened.
 *
 * Call it where its state has to outlive the button: a host that swaps the
 * button out (the Clock page clocking in, the Huddle composer expanding) keeps
 * the watch and the modal by owning the hook, and renders {@link PulseChip} and
 * {@link PulseUploadModal} from it. A button that goes away anyway while its
 * video is on its way (a timesheet change reviewed meanwhile drops its row)
 * hands the watch off, and the outcome is shown as a toast instead.
 */
import { useOptionalToast } from '@mieweb/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import { videoApi, type PulseDestination, type PulseUploadStatus } from '../../lib/api';
import {
  getStoreOS,
  isNativeApp,
  openNativePulseOrStore,
  openPulseAppOrStore,
} from '../../lib/device';
import { buildScanLink, buildUploadDeepLink } from './pulseLinks';
import { keptMessage, landedLabel } from './pulseStatus';

/** How often to ask whether the upload landed, while the page is visible. */
const STATUS_POLL_MS = 3000;
/** A Pulse link works for 30 minutes (UPLOAD_LINK_SECONDS on the server). */
const LINK_LIFETIME_MS = 30 * 60 * 1000;
/** How long the modal shows a delivered video before closing itself. */
const LANDED_CLOSE_MS = 1500;

/** The link handed out, and what it was for. */
interface PulseLink {
  videoid: string;
  uploadToken: string;
  scanLink: string;
  /** When it was reserved; the link works for LINK_LIFETIME_MS from then. */
  at: number;
  /** The destination it was reserved for, as a comparable key. */
  destinationKey: string;
}

export interface PulseUpload {
  destination: PulseDestination;
  /** Hand out the link: a new one, or the live one this hook already has. */
  start: () => Promise<void>;
  reserving: boolean;
  error: string | null;
  /** Where the current link's video stands; null before there is one. */
  status: PulseUploadStatus | null;
  /** The QR target for the modal, once a link exists. */
  scanLink: string | null;
  modalOpen: boolean;
  closeModal: () => void;
}

interface Options {
  /**
   * Called once per link when its video has landed — delivered (`done`) or
   * kept in the uploader's library (`kept`) — and the person has seen the
   * result: after the modal closes, or at once on a phone (no modal).
   */
  onSettled?: (status: PulseUploadStatus) => void;
}

const isSettled = (status: PulseUploadStatus | null) =>
  status?.state === 'done' || status?.state === 'kept';

type Toasts = NonNullable<ReturnType<typeof useOptionalToast>>;

/**
 * Keep watching a link its host has let go of (the button went away, or moved
 * on to another destination), and say where its video ended up with a toast —
 * the person pressed Pulse there, so they still hear back. `onSettled` is the
 * host's own callback, when it's still around to refresh.
 */
async function watchDetached(
  link: PulseLink,
  toasts: Toasts,
  onSettled?: (status: PulseUploadStatus) => void,
) {
  const destination = JSON.parse(link.destinationKey) as PulseDestination;
  // Until the server says it's settled: a video claimed just before its link
  // expired can still be converting, and `status` reports `expired` once a
  // link that never landed is gone.
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_MS));
    if (document.hidden) continue;
    const status = await videoApi.status(link.videoid).catch(() => null);
    if (!status || status.state === 'waiting') continue;
    if (status.state === 'expired') return;
    onSettled?.(status);
    if (status.state === 'done') {
      toasts.success(status.note ?? landedLabel(destination), { title: 'Pulse video' });
    } else if (status.state === 'kept') {
      toasts.warning(keptMessage(status.reason), { title: 'Pulse video' });
    }
    return;
  }
}

export function usePulseUpload(
  destination: PulseDestination,
  { onSettled }: Options = {},
): PulseUpload {
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  const destinationKey = JSON.stringify(destination);
  const [link, setLink] = useState<PulseLink | null>(null);
  const [status, setStatus] = useState<PulseUploadStatus | null>(null);
  const [reserving, setReserving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const notifiedFor = useRef<string | null>(null);

  // A link still on its way when this host unmounts is watched on, and its
  // outcome toasted. Read through a ref: the cleanup runs once, at unmount.
  const toasts = useOptionalToast();
  const inFlight = useRef<{ link: PulseLink | null; waiting: boolean; toasts: Toasts | null }>({
    link: null,
    waiting: false,
    toasts: null,
  });
  inFlight.current = { link, waiting: status?.state === 'waiting', toasts };
  useEffect(
    () => () => {
      const { link: pending, waiting, toasts: notify } = inFlight.current;
      if (pending && waiting && notify) void watchDetached(pending, notify);
    },
    [],
  );

  // Let go of the current link while its video may still be on its way: it's
  // watched on, and its outcome toasted and reported to the host.
  const handOff = useCallback(() => {
    const { link: pending, waiting, toasts: notify } = inFlight.current;
    if (pending && waiting && notify) {
      void watchDetached(pending, notify, (s) => onSettledRef.current?.(s));
    }
  }, []);

  // A link belongs to the destination it was reserved for. When the host
  // moves on (another ticket, the next day's plan), this hook starts afresh;
  // the earlier link still delivers where it was meant to, and is watched on.
  const current = link?.destinationKey === destinationKey ? link : null;
  useEffect(() => {
    if (!inFlight.current.link || inFlight.current.link.destinationKey === destinationKey) return;
    handOff();
    setLink(null);
    setStatus(null);
    setModalOpen(false);
  }, [destinationKey, handOff]);

  // Watch the link until its video lands or it expires: on a timer while the
  // page is visible (a phone often comes back from the Pulse app before the
  // upload finishes), and at once when it's shown again.
  useEffect(() => {
    if (!link || status?.state !== 'waiting') return;
    let cancelled = false;
    const check = async () => {
      if (cancelled || document.hidden) return;
      try {
        const next = await videoApi.status(link.videoid);
        if (!cancelled && next.state !== 'waiting') setStatus(next);
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
  }, [link, status?.state]);

  // A delivered video: show it in the modal for a moment, then close — unless
  // there's a note to read (a step after delivery failed).
  const landedCleanly = status?.state === 'done' && !status.note;
  useEffect(() => {
    if (!landedCleanly || !modalOpen) return;
    const t = setTimeout(() => setModalOpen(false), LANDED_CLOSE_MS);
    return () => clearTimeout(t);
  }, [landedCleanly, modalOpen]);

  // Tell the host once the person has seen where the video went.
  useEffect(() => {
    if (!current || !status || !isSettled(status) || modalOpen) return;
    if (notifiedFor.current === current.videoid) return;
    notifiedFor.current = current.videoid;
    onSettledRef.current?.(status);
  }, [current, status, modalOpen]);

  // Phone: straight into the Pulse app (or its store listing). Computer: QR.
  const openLink = useCallback(async ({ videoid, uploadToken }: PulseLink) => {
    const storeOS = getStoreOS();
    const deepLink = buildUploadDeepLink(videoid, uploadToken);
    if (storeOS && isNativeApp()) await openNativePulseOrStore(deepLink, storeOS);
    else if (storeOS) openPulseAppOrStore(deepLink, storeOS);
    else setModalOpen(true);
  }, []);

  const start = useCallback(async () => {
    // One link, one upload: while the last link is still live and waiting,
    // open it again rather than minting a second one that could also land.
    if (current && status?.state === 'waiting' && Date.now() - current.at < LINK_LIFETIME_MS) {
      await openLink(current);
      return;
    }

    setReserving(true);
    setError(null);
    let reservation: { videoid: string; uploadToken: string };
    try {
      reservation = await videoApi.reserve(JSON.parse(destinationKey) as PulseDestination);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Could not start Pulse. Try again.');
      return;
    } finally {
      setReserving(false);
    }

    const next: PulseLink = {
      ...reservation,
      scanLink: buildScanLink(reservation.videoid, reservation.uploadToken),
      at: Date.now(),
      destinationKey,
    };
    // An expired link's video can still be converting: watch it on.
    handOff();
    setLink(next);
    setStatus({ state: 'waiting' });
    await openLink(next);
  }, [current, status?.state, destinationKey, openLink, handOff]);

  const closeModal = useCallback(() => setModalOpen(false), []);

  return {
    destination,
    start,
    reserving,
    error,
    status: current ? status : null,
    scanLink: current?.scanLink ?? null,
    modalOpen,
    closeModal,
  };
}
