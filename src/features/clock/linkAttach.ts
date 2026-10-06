/**
 * Pasted-link helpers for {@link ./LinkAttachButton} (ticket and clock-session
 * attachments). Kept out of the component file so it exports only its
 * component (Vite's Fast Refresh).
 */
import { getYouTubeTitleFromUrl, isYouTubeUrl } from '@timehuddle/youtube';

/** How long saving a link waits for YouTube to name it before going without. */
const TITLE_LOOKUP_MS = 3000;

/** A link someone pasted, with a title when one could be found. */
export interface AddedLink {
  url: string;
  title: string | null;
}

/** The URL if it is a usable http(s) link, else null. */
export function normalizeLink(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * The title a link carries, when one can be found quickly: YouTube's, through
 * oEmbed, within {@link TITLE_LOOKUP_MS}. A title is a nicety; saving the link
 * never waits on it for longer.
 */
export function lookupLinkTitle(url: string): Promise<string | null> {
  if (!isYouTubeUrl(url)) return Promise.resolve(null);
  return Promise.race([
    getYouTubeTitleFromUrl(url).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), TITLE_LOOKUP_MS)),
  ]);
}
