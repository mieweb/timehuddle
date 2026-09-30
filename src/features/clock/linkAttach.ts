/**
 * Pasted-link helpers for {@link ./LinkAttachButton} (ticket and clock-session
 * attachments). Kept out of the component file so it exports only its
 * component (Vite's Fast Refresh).
 */

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
