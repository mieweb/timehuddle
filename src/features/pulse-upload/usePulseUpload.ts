/**
 * usePulseUpload — one Pulse link for one `destination`, from reserving it to
 * learning where the video ended up.
 *
 * Pulse is "one link, one upload": the link's token says where the video goes,
 * and the server puts it there the moment it lands (see
 * meteor-backend/server/pulse-destinations.js). This hook hands out the link
 * (QR on a computer, the Pulse app on a phone) and asks the server where the
 * video stands until it has landed, the link has expired, or the host has
 * moved on to another destination. Nothing is kept across a reload: a video
 * that lands after that is delivered all the same, it just isn't announced.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { videoApi, type PulseDestination, type PulseUploadStatus } from '../../lib/api';
import {
  getStoreOS,
  isNativeApp,
  openNativePulseOrStore,
  openPulseAppOrStore,
} from '../../lib/device';
import { buildScanLink, buildUploadDeepLink } from './pulseLinks';

/** How often to ask whether the upload landed, while the page is visible. */
const STATUS_POLL_MS = 3000;
/** How long one such question may take before it's given up on. */
const STATUS_TIMEOUT_MS = 10_000;
/** How long the modal shows a delivered video before closing itself. */
const LANDED_CLOSE_MS = 1500;

/** The link handed out: one video id, the token that authorizes it, and the QR target. */
export interface PulseLink {
  videoid: string;
  uploadToken: string;
  scanLink: string;
}

export interface PulseUpload {
  destination: PulseDestination;
  /** Hand out the link: a new one, or the live one this hook already has. */
  start: () => Promise<void>;
  reserving: boolean;
  error: string | null;
  /** The current link, while there is one for this destination. */
  link: PulseLink | null;
  /** Where the current link's video stands; null before there is one. */
  status: PulseUploadStatus | null;
  modalOpen: boolean;
  closeModal: () => void;
  /**
   * Let go of the current link: no more status checks, no modal, no note. A
   * video that still lands on it is delivered where the link said all the
   * same (a library video stays in the library); it just isn't announced here.
   */
  reset: () => void;
}

interface Options {
  /**
   * Called once per link when its video has landed — delivered (`done`) or
   * kept (`kept`) — and the person has seen the result: after the modal
   * closes, or at once on a phone (no modal). `link` is the link it landed
   * on, for a host that wants the video itself (a composer attaching it).
   */
  onSettled?: (status: PulseUploadStatus, link: PulseLink) => void;
}

type LiveLink = PulseLink & { destinationKey: string };

const isSettled = (status: PulseUploadStatus | null) =>
  status?.state === 'done' || status?.state === 'kept';

export function usePulseUpload(
  destination: PulseDestination,
  { onSettled }: Options = {},
): PulseUpload {
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  // Compared as a key: hosts build the destination object on every render.
  const destinationKey = JSON.stringify(destination);
  const latestKey = useRef(destinationKey);
  latestKey.current = destinationKey;
  const mounted = useRef(true);
  // Cancels a phone launch still on its way — a native one checking whether
  // Pulse is installed, or a browser one deciding between the app and its
  // store listing — so it can't open for a screen that has since changed.
  const launch = useRef<() => void>(() => {});
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      launch.current();
    };
  }, []);

  const [link, setLink] = useState<LiveLink | null>(null);
  const [status, setStatus] = useState<PulseUploadStatus | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [reserving, setReserving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notifiedFor = useRef<string | null>(null);

  // A link belongs to the destination it was reserved for. When the host
  // moves on (another ticket), this hook starts afresh; the earlier link
  // still delivers where it was meant to.
  const current = link?.destinationKey === destinationKey ? link : null;
  useEffect(() => {
    // Whatever went wrong was for the destination before this one.
    setError(null);
    launch.current();
  }, [destinationKey]);
  useEffect(() => {
    if (!link || link.destinationKey === destinationKey) return;
    setLink(null);
    setStatus(null);
    setModalOpen(false);
  }, [link, destinationKey]);

  // Ask the server where the video stands until it lands or the link expires:
  // on a timer while the page is visible, and at once when it's shown again (a
  // phone often comes back from the Pulse app before the upload finishes).
  useEffect(() => {
    if (!current || status?.state !== 'waiting') return;
    let cancelled = false;
    // One question at a time, each with a deadline: a stalled server can't
    // pile up requests, and none outlives this link.
    let inFlight: AbortController | null = null;
    const check = async () => {
      if (cancelled || document.hidden || inFlight) return;
      const controller = new AbortController();
      inFlight = controller;
      const deadline = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);
      try {
        const next = await videoApi.status(current.videoid, current.uploadToken, controller.signal);
        if (!cancelled && next.state !== 'waiting') setStatus(next);
      } catch {
        // transient, or aborted: try again next tick
      } finally {
        clearTimeout(deadline);
        inFlight = null;
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
      inFlight?.abort();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [current, status?.state]);

  // A delivered video: show it in the modal for a moment, then close.
  const landed = status?.state === 'done';
  useEffect(() => {
    if (!landed || !modalOpen) return;
    const t = setTimeout(() => setModalOpen(false), LANDED_CLOSE_MS);
    return () => clearTimeout(t);
  }, [landed, modalOpen]);

  // Tell the host once the person has seen where the video went.
  useEffect(() => {
    if (!current || !status || !isSettled(status) || modalOpen) return;
    if (notifiedFor.current === current.videoid) return;
    notifiedFor.current = current.videoid;
    onSettledRef.current?.(status, current);
  }, [current, status, modalOpen]);

  // Phone: straight into the Pulse app (or its store listing). Computer: QR.
  const openLink = useCallback(async ({ videoid, uploadToken }: PulseLink) => {
    const storeOS = getStoreOS();
    const deepLink = buildUploadDeepLink(videoid, uploadToken);
    launch.current();
    const controller = new AbortController();
    launch.current = () => controller.abort();
    if (storeOS && isNativeApp()) {
      await openNativePulseOrStore(deepLink, storeOS, controller.signal);
    } else if (storeOS) {
      const cancel = openPulseAppOrStore(deepLink, storeOS);
      launch.current = () => {
        controller.abort();
        cancel();
      };
    } else {
      setModalOpen(true);
    }
  }, []);

  const start = useCallback(async () => {
    // One link, one upload: while the last link is still waiting, open it
    // again (a re-scan resumes it) rather than mint a second that could also land.
    if (current && status?.state === 'waiting') {
      await openLink(current);
      return;
    }

    setReserving(true);
    setError(null);
    let reservation: { videoid: string; uploadToken: string };
    try {
      reservation = await videoApi.reserve(JSON.parse(destinationKey) as PulseDestination);
    } catch (e) {
      // Not an error of the destination now on screen, if the host moved on meanwhile.
      if (mounted.current && latestKey.current === destinationKey) {
        setError(e instanceof Error && e.message ? e.message : 'Could not start Pulse. Try again.');
      }
      return;
    } finally {
      setReserving(false);
    }

    // The host moved on (another ticket) or went away while this was
    // reserving: nobody has seen this link, so nothing can upload with it.
    // Dropped (it expires unused) rather than opened for somewhere not on screen.
    if (!mounted.current || latestKey.current !== destinationKey) return;

    const next: LiveLink = {
      ...reservation,
      scanLink: buildScanLink(reservation.videoid, reservation.uploadToken),
      destinationKey,
    };
    setLink(next);
    setStatus({ state: 'waiting' });
    await openLink(next);
  }, [current, status?.state, destinationKey, openLink]);

  const closeModal = useCallback(() => setModalOpen(false), []);
  const reset = useCallback(() => {
    launch.current();
    setLink(null);
    setStatus(null);
    setModalOpen(false);
    setError(null);
  }, []);

  return {
    destination,
    start,
    reserving,
    error,
    link: current,
    status: current ? status : null,
    modalOpen,
    closeModal,
    reset,
  };
}
