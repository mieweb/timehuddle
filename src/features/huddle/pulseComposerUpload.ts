// Persistence for the Huddle composer's Pulse upload.
//
// A library reservation is only linked to the composer in client state, so
// anything that tears that state down between "reserve" and "upload finished"
// loses the video: on mobile the Pulse deep link backgrounds (and can reload)
// the app, and on desktop closing the QR modal used to stop the watcher. Both
// are the normal flow, so the pending videoid — and the resolved video once it
// finishes — are persisted and restored on remount.
//
// Kept out of PulseAttachButton.tsx on purpose: a file that exports a React
// component must export *only* components, or Vite's react plugin disables Fast
// Refresh and forces a full page reload on every HMR update (which itself aborts
// in-flight uploads). These are plain functions, so they live here.
import type { MediaItem } from './types';

const PENDING_STORAGE_PREFIX = 'pulsevault:composer:';
/** Give a recording session plenty of time, but don't poll forever. */
export const PENDING_TTL_MS = 30 * 60 * 1000;
export const POLL_INTERVAL_MS = 4000;

export interface PendingUpload {
  videoid: string;
  reservedAt: number;
  /**
   * Set once the upload finishes. Persisting the resolved media item (not just
   * the reservation) lets the composer re-attach the video after the WebView
   * reloads on return from the Pulse app — the reservation alone is consumed
   * the moment the video is attached, so without this the finished clip is lost.
   */
  done?: MediaItem;
}

function pendingKey(scope: string): string {
  return `${PENDING_STORAGE_PREFIX}${scope}`;
}

export function readPending(scope: string): PendingUpload | null {
  try {
    const raw = localStorage.getItem(pendingKey(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingUpload;
    if (!parsed?.videoid || Date.now() - parsed.reservedAt > PENDING_TTL_MS) {
      localStorage.removeItem(pendingKey(scope));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writePending(scope: string, videoid: string): PendingUpload {
  const pending: PendingUpload = { videoid, reservedAt: Date.now() };
  try {
    localStorage.setItem(pendingKey(scope), JSON.stringify(pending));
  } catch {
    // localStorage may be unavailable in some native contexts — the in-memory
    // watcher still covers the same-session case.
  }
  return pending;
}

function clearPending(scope: string): void {
  try {
    localStorage.removeItem(pendingKey(scope));
  } catch {
    // ignore
  }
}

/** Persist a finished video so a remounted composer can re-attach it. */
export function persistDone(scope: string, videoid: string, media: MediaItem): void {
  try {
    const pending: PendingUpload = { videoid, reservedAt: Date.now(), done: media };
    localStorage.setItem(pendingKey(scope), JSON.stringify(pending));
  } catch {
    // ignore — same-session state still holds the attachment.
  }
}

/**
 * Forget any persisted Pulse upload for a composer scope. The host calls this
 * once the post is submitted/cancelled (or the video chip is removed) so a
 * finished clip isn't re-attached to the next post.
 */
export function clearComposerPulseUpload(scope: string): void {
  clearPending(scope);
}

/**
 * Build a composer MediaItem for a finished PulseVault video.
 *
 * The URL is a path, not an absolute address: this item is persisted to
 * localStorage and can be restored days later on a backend that has since
 * moved hosts. Readers bind it to the current origin via `resolveMediaUrl`.
 */
export function videoMediaItem(videoid: string, filename: string, size: number): MediaItem {
  return {
    id: videoid,
    type: 'video',
    size,
    mimeType: 'video/mp4',
    url: `/pulsevault/artifacts/${videoid}`,
    filename,
  };
}
