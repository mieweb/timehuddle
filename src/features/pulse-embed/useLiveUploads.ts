/**
 * The server's Pulse uploads for one place (a ticket's or a session's
 * `targetKey`), kept current (PLAN §7.2 "Publications and live update"):
 *
 *  - live: the `pulseUploads.forTarget` publication over DDP, which carries
 *    everyone's videos on their way ("Uploading from iPhone…" on a desktop);
 *  - the caller's own rows with their keys, from `pulseUploads.list`, read on
 *    mount, when the page comes back to the foreground, when DDP reconnects,
 *    when a live row lands, and every 10 s while a video is on its way;
 *  - `onLanded` when a video lands, so the place refetches its own videos
 *    and the server's card takes the row's place.
 *
 * Works in a browser too: it needs the server, not Pulse.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { pulseUploadApi, type PulseUploadPublic, type PulseUploadState } from '../../lib/api';
import { getDdpClient } from '../../lib/ddp';
import {
  IN_FLIGHT_STATES,
  leftPublication,
  mergeServerRows,
  newlyDelivered,
  uploadFromDoc,
} from './mergeRows';

/** How often the rows are read again while a video is on its way. */
export const LIVE_UPLOADS_POLL_MS = 10_000;

const COLLECTION = 'pulseUploads';
const PUBLICATION = 'pulseUploads.forTarget';

export interface LiveUploads {
  uploads: PulseUploadPublic[];
  loading: boolean;
  error: unknown;
  /** Read the caller's rows again now. */
  refresh(): void;
}

export interface LiveUploadsOptions {
  /** Off: no subscription, no reads (the place isn't on screen). Default on. */
  enabled?: boolean;
  /** A video on this place landed (or left the live list): refetch the place's videos. */
  onLanded?: () => void;
}

/** The server's uploads for `targetKey`; null reads nothing. */
export function useLiveUploads(
  targetKey: string | null,
  options: LiveUploadsOptions = {},
): LiveUploads {
  const enabled = (options.enabled ?? true) && !!targetKey;
  const [listed, setListed] = useState<PulseUploadPublic[]>([]);
  const [live, setLive] = useState<PulseUploadPublic[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<unknown>(null);

  const onLanded = useRef(options.onLanded);
  onLanded.current = options.onLanded;

  const reading = useRef<Promise<void> | null>(null);
  const refresh = useCallback(() => {
    if (!enabled || !targetKey || reading.current) return;
    reading.current = (async () => {
      try {
        const { uploads } = await pulseUploadApi.list({ targetKey });
        setListed(uploads);
        setError(null);
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
        reading.current = null;
      }
    })();
  }, [enabled, targetKey]);

  // The caller's own rows: now, on reconnect, and back in the foreground.
  useEffect(() => {
    if (!enabled) {
      setListed([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    const offReconnect = getDdpClient().onReconnect(refresh);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      offReconnect();
    };
  }, [enabled, refresh]);

  // Everyone's videos on their way, live over DDP.
  useEffect(() => {
    if (!enabled || !targetKey) {
      setLive([]);
      return;
    }
    const ddp = getDdpClient();
    const read = () =>
      setLive(
        ddp
          .docs(COLLECTION)
          .map((doc) => uploadFromDoc(doc as Record<string, unknown>))
          .filter(
            (u): u is PulseUploadPublic =>
              !!u && u.targetKey === targetKey && IN_FLIGHT_STATES.has(u.state),
          ),
      );
    const offChange = ddp.onCollectionChange(COLLECTION, read);
    const unsubscribe = ddp.subscribe(PUBLICATION, [targetKey], read);
    read();
    return () => {
      offChange();
      unsubscribe();
    };
  }, [enabled, targetKey]);

  const uploads = useMemo(() => mergeServerRows(listed, live), [listed, live]);

  // A video landed: the place refetches, and so do the caller's rows.
  const seenStates = useRef(new Map<string, PulseUploadState>());
  const seenLive = useRef(new Set<string>());
  useEffect(() => {
    const landed = newlyDelivered(seenStates.current, uploads);
    const left = leftPublication(seenLive.current, live);
    seenStates.current = new Map(uploads.map((u) => [u.id, u.state]));
    seenLive.current = new Set(live.map((u) => u.id));
    if (left.length > 0) refresh();
    if (landed.length > 0 || left.length > 0) onLanded.current?.();
  }, [uploads, live, refresh]);

  // Every 10 s while a video is on its way.
  const moving = uploads.some((u) => IN_FLIGHT_STATES.has(u.state));
  useEffect(() => {
    if (!enabled || !moving) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, LIVE_UPLOADS_POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, moving, refresh]);

  return { uploads, loading, error, refresh };
}
