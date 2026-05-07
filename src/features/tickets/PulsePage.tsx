/**
 * PulsePage — Instagram Reels–style gallery of Pulse video attachments.
 *
 * Shows a tight 3-col grid of silent thumbnails. Tapping any cell opens a
 * fullscreen lightbox with the video playing and ticket info below it.
 */
import { faFilm, faPlay, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Badge, Spinner, Text } from '@mieweb/ui';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { attachmentApi, ticketApi, type Attachment, type Ticket } from '../../lib/api';
import { useTeam } from '../../lib/TeamContext';
import { AppPage } from '../../ui/AppPage';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TicketVideo {
  id: string;
  url: string;
  title: string;
  ticketTitle: string;
  date: string;
}

// ─── Thumbnail cell ───────────────────────────────────────────────────────────

interface ThumbnailProps {
  item: TicketVideo;
  onClick: () => void;
}

const Thumbnail: React.FC<ThumbnailProps> = ({ item, onClick }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loaded, setLoaded] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      className="pulse-thumb group relative aspect-square w-full overflow-hidden bg-black focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      aria-label={`Play video: ${item.title}`}
    >
      <video
        ref={videoRef}
        src={item.url}
        muted
        playsInline
        preload="metadata"
        onLoadedMetadata={() => setLoaded(true)}
        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
      />

      {/* play icon overlay */}
      <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/80 text-black shadow-lg">
          <FontAwesomeIcon icon={faPlay} className="ml-0.5 text-sm" />
        </div>
      </div>

      {/* bottom label */}
      <div className="absolute bottom-0 left-0 right-0 bg-linear-to-t from-black/70 to-transparent px-2 pb-1.5 pt-4">
        <p className="truncate text-[11px] font-medium leading-tight text-white">
          {item.ticketTitle}
        </p>
      </div>

      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-neutral-900">
          <Spinner size="sm" />
        </div>
      )}
    </button>
  );
};

// ─── Lightbox ─────────────────────────────────────────────────────────────────

interface LightboxProps {
  item: TicketVideo;
  onClose: () => void;
}

const Lightbox: React.FC<LightboxProps> = ({ item, onClose }) => {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return createPortal(
    <div
      className="pulse-lightbox fixed inset-0 z-200 flex flex-col items-center justify-center bg-black/95"
      role="dialog"
      aria-modal="true"
      aria-label={`Playing: ${item.title}`}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* close button */}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        aria-label="Close video"
      >
        <FontAwesomeIcon icon={faXmark} />
      </button>

      {/* video */}
      <video
        src={item.url}
        controls
        autoPlay
        playsInline
        className="pulse-lightbox-video max-h-[75dvh] w-full max-w-2xl rounded-lg object-contain shadow-2xl"
        aria-label={item.title}
      />

      {/* info strip */}
      <div className="mt-4 flex w-full max-w-2xl flex-col gap-1.5 px-4">
        <Text size="sm" weight="semibold" className="text-white">
          {item.title}
        </Text>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" size="sm">
            {item.ticketTitle}
          </Badge>
          <Text size="xs" className="text-white/50">
            {new Date(item.date).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}
          </Text>
        </div>
      </div>
    </div>,
    document.body,
  );
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export const PulsePage: React.FC = () => {
  const { selectedTeamId, teamsReady } = useTeam();
  const [items, setItems] = useState<TicketVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<TicketVideo | null>(null);

  const fetchAll = useCallback(async () => {
    if (!selectedTeamId) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const tickets = await ticketApi.getTickets(selectedTeamId);
      const results = await Promise.all(
        tickets.map(async (ticket: Ticket) => {
          try {
            const attachments = await attachmentApi.list('ticket', ticket.id);
            return attachments
              .filter((a: Attachment) => a.type === 'video')
              .map((a: Attachment): TicketVideo => ({
                id: a.id,
                url: a.url,
                title: a.title ?? 'Pulse Video',
                ticketTitle: ticket.title,
                date: a.addedAt,
              }));
          } catch {
            return [];
          }
        }),
      );
      setItems(
        results
          .flat()
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
      );
    } finally {
      setLoading(false);
    }
  }, [selectedTeamId]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  if (!teamsReady) {
    return (
      <div className="flex items-center justify-center p-12">
        <Spinner size="lg" label="Loading…" />
      </div>
    );
  }

  return (
    <AppPage>
      {loading ? (
        <div className="flex items-center justify-center p-12">
          <Spinner size="lg" label="Loading videos…" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 p-12 text-center">
          <FontAwesomeIcon icon={faFilm} className="text-3xl text-muted-foreground" />
          <Text variant="muted" size="sm">
            No pulse videos yet. Upload a video from any ticket to see it here.
          </Text>
        </div>
      ) : (
        <div className="pulse-gallery grid grid-cols-3 gap-0.5" role="list" aria-label="Pulse videos">
          {items.map((item) => (
            <div key={item.id} role="listitem">
              <Thumbnail item={item} onClick={() => setActive(item)} />
            </div>
          ))}
        </div>
      )}

      {active && <Lightbox item={active} onClose={() => setActive(null)} />}
    </AppPage>
  );
};
