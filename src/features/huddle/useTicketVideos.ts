/**
 * useTicketVideos — the videos already attached to a ticket, as composer
 * attachments. Picking a ticket for a post pulls these in, so a Pulse video
 * recorded on the ticket shows up in the Huddle post about it.
 */
import { useEffect, useState } from 'react';
import { attachmentApi } from '@lib/api';
import type { MediaItem } from './types';

export interface TicketVideos {
  videos: MediaItem[];
  /** True until the *selected* ticket's own request has settled. */
  loading: boolean;
  /** Set when the selected ticket's request failed, so a send can refuse. */
  error: string | null;
}

interface Loaded {
  ticketId: string | undefined;
  videos: MediaItem[];
  error: string | null;
}

const NOTHING_LOADED: Loaded = { ticketId: undefined, videos: [], error: null };

export function useTicketVideos(ticketId: string | undefined): TicketVideos {
  const [loaded, setLoaded] = useState<Loaded>(NOTHING_LOADED);

  useEffect(() => {
    // Drop the last result so reselecting the same ticket refetches before it reads as settled.
    setLoaded(NOTHING_LOADED);
    if (!ticketId) return;
    let cancelled = false;
    attachmentApi
      .list('ticket', ticketId)
      .then((attachments) => {
        if (cancelled) return;
        setLoaded({
          ticketId,
          error: null,
          videos: attachments
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
          ticketId,
          videos: [],
          error: "Couldn't load the ticket's videos. Pick the ticket again to retry.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [ticketId]);

  // State holds whichever ticket resolved last, not necessarily the selected
  // one. Reporting it as the selection's would let a fast send attach ticket
  // A's videos to a post about ticket B, so anything but an exact match reads
  // as "still loading" and the host holds the send.
  const settled = !!ticketId && loaded.ticketId === ticketId;
  return {
    videos: settled ? loaded.videos : [],
    loading: !!ticketId && !settled,
    error: settled ? loaded.error : null,
  };
}
