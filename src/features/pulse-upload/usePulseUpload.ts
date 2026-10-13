/**
 * usePulseUpload — one Pulse link for one `destination`, from reserving it to
 * learning where the video ended up.
 *
 * Pulse is "one link, one upload": the link's token says where the video goes,
 * and the server puts it there the moment it lands (see
 * meteor-backend/server/pulse-destinations.js). This hook hands out the link
 * (a QR on a computer, an Open Pulse link on a phone, the Pulse app itself from
 * the TimeHuddle app) and asks the server where the
 * video stands until it has landed, the link has expired, or the host has
 * moved on to another destination. The link is Pulse's https pairing link (see
 * pulseLinks.ts): the phone's OS opens Pulse from it, or Pulse's own page sends
 * the person to the store. Nothing is kept across a reload: a video
 * that lands after that is delivered all the same, it just isn't announced.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { videoApi, type PulseDestination, type PulseUploadStatus } from '../../lib/api';
import { isMobileBrowser, isNativeApp, openExternalUrl } from '../../lib/device';
import { buildPulseLink } from './pulseLinks';
import { uploadVideoFile, videoFileProblem } from './videoFile';

/** How often to ask whether the upload landed, while the page is visible. */
const STATUS_POLL_MS = 3000;
/** How long one such question may take before it's given up on. */
const STATUS_TIMEOUT_MS = 10_000;
/** How long the modal shows a delivered video before closing itself. */
const LANDED_CLOSE_MS = 1500;
/**
 * How long a link prepared ahead of a phone's tap is used before a fresh one
 * replaces it: well inside the token's 30 minutes (UPLOAD_LINK_SECONDS).
 */
const PREPARED_FRESH_MS = 20 * 60 * 1000;

/** The link handed out: one video id, the token that authorizes it, and the pairing link. */
export interface PulseLink {
  videoid: string;
  uploadToken: string;
  /** Pulse's https pairing link: the QR's target, and what a phone opens. */
  url: string;
}

export interface PulseUpload {
  destination: PulseDestination;
  /** Hand out the link: a new one, or the live one this hook already has. */
  start: () => Promise<void>;
  /** Send a video file from this device through a new link instead of the Pulse app. */
  upload: (file: File) => Promise<void>;
  reserving: boolean;
  /** Sent fraction (0–1) of a file on its way up; null otherwise. */
  progress: number | null;
  /** A file's bytes are in and the server is converting and delivering it. */
  processing: boolean;
  error: string | null;
  /** The current link, while there is one for this destination. */
  link: PulseLink | null;
  /** Where the current link's video stands; null before there is one. */
  status: PulseUploadStatus | null;
  modalOpen: boolean;
  closeModal: () => void;
}

interface Options {
  /**
   * Called once per link when its video has landed — delivered (`done`) or
   * kept (`kept`) — and the person has seen the result: after the window
   * closes, or at once in the TimeHuddle app (no window).
   */
  onSettled?: (status: PulseUploadStatus) => void;
}

type LiveLink = PulseLink & { destinationKey: string; fromFile: boolean };
type Reservation = { videoid: string; uploadToken: string };
type Prepared = { destinationKey: string; reservation: Reservation; at: number };

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
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const [link, setLink] = useState<LiveLink | null>(null);
  const [status, setStatus] = useState<PulseUploadStatus | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [reserving, setReserving] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notifiedFor = useRef<string | null>(null);

  // In a phone's browser the link is ready before the tap, so the tap opens
  // Pulse itself: a Universal Link / App Link opens the app only from a tap,
  // not from a navigation that waited on the server. Reserving writes nothing
  // (it signs a token), so an unused link just expires. Refreshed well before
  // it would, and after each use for the next video.
  const onPhoneBrowser = isMobileBrowser();
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [prepareRound, setPrepareRound] = useState(0);
  useEffect(() => {
    if (!onPhoneBrowser) return;
    let cancelled = false;
    videoApi
      .reserve(JSON.parse(destinationKey) as PulseDestination)
      .then((reservation) => {
        if (!cancelled) setPrepared({ destinationKey, reservation, at: Date.now() });
      })
      .catch(() => {
        // The tap reserves again, and says what went wrong.
      });
    const refresh = setTimeout(() => setPrepareRound((n) => n + 1), PREPARED_FRESH_MS);
    return () => {
      cancelled = true;
      clearTimeout(refresh);
    };
  }, [onPhoneBrowser, destinationKey, prepareRound]);

  // A link belongs to the destination it was reserved for. When the host
  // moves on (another ticket), this hook starts afresh; the earlier link
  // still delivers where it was meant to.
  const current = link?.destinationKey === destinationKey ? link : null;
  useEffect(() => {
    // Whatever went wrong was for the destination before this one.
    setError(null);
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
    onSettledRef.current?.(status);
  }, [current, status, modalOpen]);

  // Where the link goes, all opening Pulse when it's installed and Pulse's
  // page (and from there the store) when it isn't:
  // - the TimeHuddle app hands it to the OS;
  // - a phone's browser follows it, within the tap (`inTap`): one tap, and
  //   Pulse is open;
  // - a computer shows the QR window — as does a phone whose tap was spent
  //   waiting on the server (no link was ready yet), with an "Open Pulse" link.
  const openLink = useCallback(
    async ({ url }: PulseLink, inTap: boolean) => {
      if (isNativeApp()) await openExternalUrl(url);
      else if (onPhoneBrowser && inTap) window.location.assign(url);
      else setModalOpen(true);
    },
    [onPhoneBrowser],
  );

  /** Make `reservation` the destination's link, waiting for its video. */
  const adopt = useCallback(
    (reservation: Reservation, fromFile: boolean): LiveLink => {
      const next: LiveLink = {
        ...reservation,
        url: buildPulseLink(reservation.videoid, reservation.uploadToken),
        destinationKey,
        fromFile,
      };
      setLink(next);
      setStatus({ state: 'waiting' });
      return next;
    },
    [destinationKey],
  );

  /** A new link for the destination on screen, or null when it failed or the host moved on. */
  const reserve = useCallback(
    async (fromFile: boolean): Promise<LiveLink | null> => {
      setReserving(true);
      setError(null);
      let reservation: Reservation;
      try {
        reservation = await videoApi.reserve(JSON.parse(destinationKey) as PulseDestination);
      } catch (e) {
        // Not an error of the destination now on screen, if the host moved on meanwhile.
        if (mounted.current && latestKey.current === destinationKey) {
          setError(
            e instanceof Error && e.message ? e.message : 'Could not start Pulse. Try again.',
          );
        }
        return null;
      } finally {
        setReserving(false);
      }

      // The host moved on (another ticket) or went away while this was
      // reserving: nobody has seen this link, so nothing can upload with it.
      // Dropped (it expires unused) rather than used for somewhere not on screen.
      if (!mounted.current || latestKey.current !== destinationKey) return null;
      return adopt(reservation, fromFile);
    },
    [destinationKey, adopt],
  );

  const start = useCallback(async () => {
    // One link, one upload: while the last link is still waiting, open it
    // again (a re-scan resumes it) rather than mint a second that could also land.
    if (current && status?.state === 'waiting') {
      await openLink(current, true);
      return;
    }
    // A phone with a link ready: opened before anything is awaited, so still
    // within the tap. The next video gets a fresh one.
    const ready =
      prepared?.destinationKey === destinationKey && Date.now() - prepared.at < PREPARED_FRESH_MS
        ? prepared
        : null;
    if (ready) {
      setPrepared(null);
      setPrepareRound((n) => n + 1);
      await openLink(adopt(ready.reservation, false), true);
      return;
    }
    const next = await reserve(false);
    if (next) await openLink(next, false);
  }, [current, status?.state, prepared, destinationKey, adopt, reserve, openLink]);

  const upload = useCallback(
    async (file: File) => {
      const problem = videoFileProblem(file);
      if (problem) {
        setError(problem);
        return;
      }
      const next = await reserve(true);
      if (!next) return;
      setProgress(0);
      try {
        await uploadVideoFile(file, next, (f) => mounted.current && setProgress(f));
      } catch (e) {
        if (!mounted.current) return;
        // Nothing landed: drop the link so the chips are free again.
        setLink(null);
        setStatus(null);
        setError((e as Error).message);
      } finally {
        if (mounted.current) setProgress(null);
      }
    },
    [reserve],
  );

  const closeModal = useCallback(() => setModalOpen(false), []);

  return {
    destination,
    start,
    upload,
    reserving,
    progress,
    processing: Boolean(current?.fromFile) && status?.state === 'waiting' && progress === null,
    error,
    link: current,
    status: current ? status : null,
    modalOpen,
    closeModal,
  };
}
