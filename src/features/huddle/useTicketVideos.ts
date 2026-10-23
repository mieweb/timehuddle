/**
 * useTicketVideos — the videos already attached to a post's tickets, as
 * composer attachments. Picking a ticket for a post pulls these in, so a Pulse
 * video recorded on the ticket shows up in the Huddle post about it.
 */
import { useEffect, useState } from 'react';
import { attachmentApi } from '@lib/api';
import type { MediaItem } from './types';

export interface TicketVideos {
  videos: MediaItem[];
  /** True until the *selected* tickets' own requests have settled. */
  loading: boolean;
  /** Set when a selected ticket's request failed, so a send can refuse. */
  error: string | null;
}

interface Loaded {
  /** The selection the result is for, as {@link selectionKey}. */
  key: string;
  videos: MediaItem[];
  error: string | null;
}

const NOTHING_LOADED: Loaded = { key: '', videos: [], error: null };

const selectionKey = (ticketIds: string[]) => ticketIds.join(',');

export function useTicketVideos(ticketIds: string[]): TicketVideos {
  const [loaded, setLoaded] = useState<Loaded>(NOTHING_LOADED);
  const key = selectionKey(ticketIds);

  useEffect(() => {
    // Drop the last result so reselecting the same tickets refetches before it reads as settled.
    setLoaded(NOTHING_LOADED);
    if (!key) return;
    let cancelled = false;
    Promise.all(key.split(',').map((ticketId) => attachmentApi.list('ticket', ticketId)))
      .then((lists) => {
        if (cancelled) return;
        setLoaded({
          key,
          error: null,
          videos: lists
            .flat()
            .filter((att) => att.type === 'video')
            .map((att) => ({
              id: att.id,
              url: att.url,
              filename: att.title || 'video',
              type: 'video',
              size: 0, // not reported by the attachments API
              mimeType: 'video/mp4',
            })),
        });
      })
      .catch((err) => {
        console.error('[useTicketVideos] Failed to fetch ticket videos:', err);
        if (cancelled) return;
        setLoaded({
          key,
          videos: [],
          error: "Couldn't load the tickets' videos. Remove and re-add a ticket to retry.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  // State holds whichever selection resolved last, not necessarily the current
  // one. Reporting it as the current one's would let a fast send attach ticket
  // A's videos to a post about ticket B, so anything but an exact match reads
  // as "still loading" and the host holds the send.
  const settled = !!key && loaded.key === key;
  return {
    videos: settled ? loaded.videos : [],
    loading: !!key && !settled,
    error: settled ? loaded.error : null,
  };
}
