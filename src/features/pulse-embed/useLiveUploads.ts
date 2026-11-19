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

/** Rows read for one place; dropped as soon as the hook shows another. */
interface ForKey<T> {
  key: string | null;
  rows: T[];
}

/** The caller's own rows for one place, with the read's error. */
interface Listed extends ForKey<PulseUploadPublic> {
  error: unknown;
}

const NONE: PulseUploadPublic[] = [];
const NO_LISTED: Listed = { key: null, rows: NONE, error: null };
const NO_LIVE: ForKey<PulseUploadPublic> = { key: null, rows: NONE };

/** The server's uploads for `targetKey`; null reads nothing. */
export function useLiveUploads(
  targetKey: string | null,
  options: LiveUploadsOptions = {},
): LiveUploads {
  const enabled = (options.enabled ?? true) && !!targetKey;
  const key = enabled ? targetKey : null;
  // Each read and each live list is tagged with its place: a place's rows
  // never show on another, even for one render.
  const [listed, setListed] = useState<Listed>(NO_LISTED);
  const [live, setLive] = useState<ForKey<PulseUploadPublic>>(NO_LIVE);

  const onLanded = useRef(options.onLanded);
  onLanded.current = options.onLanded;

  /** The read in flight, for its place; `again` asks for one more after it. */
  const reading = useRef<{ key: string; again: boolean } | null>(null);
  const refresh = useCallback(() => {
    if (!key) return;
    const current = reading.current;
    if (current?.key === key) {
      // A read for this place is on its way: it may predate the change, so
      // one more follows it.
      current.again = true;
      return;
    }
    // None, or one for another place, which is dropped when it answers.
    const read = { key, again: false };
    reading.current = read;
    void (async () => {
      do {
        read.again = false;
        let next: Listed;
        try {
          const { uploads } = await pulseUploadApi.list({ targetKey: key });
          next = { key, rows: uploads, error: null };
        } catch (error) {
          next = { key, rows: NONE, error };
        }
        if (reading.current !== read) return;
        setListed((prev) =>
          next.error !== null && prev.key === key ? { ...prev, error: next.error } : next,
        );
      } while (read.again && reading.current === read);
      if (reading.current === read) reading.current = null;
    })();
  }, [key]);

  // The caller's own rows: now, on reconnect, and back in the foreground.
  useEffect(() => {
    if (!key) return;
    refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    const offReconnect = getDdpClient().onReconnect(refresh);
    return () => {
      // A read still on its way is for a place no longer shown.
      reading.current = null;
      document.removeEventListener('visibilitychange', onVisible);
      offReconnect();
    };
  }, [key, refresh]);

  // Everyone's videos on their way, live over DDP.
  useEffect(() => {
    if (!key) return;
    const ddp = getDdpClient();
    const read = () =>
      setLive({
        key,
        rows: ddp
          .docs(COLLECTION)
          .map((doc) => uploadFromDoc(doc as Record<string, unknown>))
          .filter(
            (u): u is PulseUploadPublic =>
              !!u && u.targetKey === key && IN_FLIGHT_STATES.has(u.state),
          ),
      });
    const offChange = ddp.onCollectionChange(COLLECTION, read);
    const unsubscribe = ddp.subscribe(PUBLICATION, [key], read);
    read();
    return () => {
      offChange();
      unsubscribe();
    };
  }, [key]);

  const listedRows = key !== null && listed.key === key ? listed.rows : NONE;
  const liveRows = key !== null && live.key === key ? live.rows : NONE;
  const uploads = useMemo(() => mergeServerRows(listedRows, liveRows), [listedRows, liveRows]);
  const loading = key !== null && listed.key !== key;
  const error = key !== null && listed.key === key ? listed.error : null;

  // A video landed: the place refetches, and so do the caller's rows. The
  // first rows of a place are where it starts, not changes.
  const seen = useRef<{
    key: string | null;
    states: Map<string, PulseUploadState>;
    live: Set<string>;
  }>({ key: null, states: new Map(), live: new Set() });
  useEffect(() => {
    const before = seen.current;
    seen.current = {
      key,
      states: new Map(uploads.map((u) => [u.id, u.state])),
      live: new Set(liveRows.map((u) => u.id)),
    };
    if (before.key !== key) return;
    const landed = newlyDelivered(before.states, uploads);
    const left = leftPublication(before.live, liveRows);
    if (left.length > 0) refresh();
    if (landed.length > 0 || left.length > 0) onLanded.current?.();
  }, [key, uploads, liveRows, refresh]);

  // Every 10 s while a video is on its way.
  const moving = uploads.some((u) => IN_FLIGHT_STATES.has(u.state));
  useEffect(() => {
    if (!key || !moving) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, LIVE_UPLOADS_POLL_MS);
    return () => clearInterval(timer);
  }, [key, moving, refresh]);

  return { uploads, loading, error, refresh };
}
