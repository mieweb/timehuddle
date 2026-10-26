/**
 * Finding links in plain text, for {@link ./LinkifiedText}. Kept out of the
 * component file so it exports only its component (Vite's Fast Refresh).
 */

/** How a link in body text looks, wherever text is shown with its links. */
export const linkClassName =
  'text-blue-600 underline [overflow-wrap:anywhere] hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300';

/** The same on a surface that stays dark whatever the theme (the profile hero). */
export const inverseLinkClassName =
  'text-blue-400 underline [overflow-wrap:anywhere] hover:text-blue-300';

export interface TextPart {
  text: string;
  /** Set when this part is a link. */
  href?: string;
}

// Schemes are case-insensitive: `HTTPS://x.dev` is a link too.
const URL_RE = /https?:\/\/[^\s<>"]+/gi;

/**
 * Punctuation that ends a sentence rather than the URL ("see https://x.dev.").
 * A closing bracket only counts when the URL hasn't opened one for it, so a
 * Wikipedia-style `…/Foo_(bar)` or an IPv6 `http://[::1]` keeps its own, and
 * `(…/Foo_(bar))` or `[https://x.dev]` loses only the sentence's.
 *
 * Linear: each bracket's balance is counted once and kept up to date as the
 * end moves left, so a URL followed by thousands of `)` can't stall a render.
 */
function trimTrailing(url: string): string {
  // Closers minus openers, per closing bracket, over url[0, end).
  const excess: Record<string, number> = { ')': 0, ']': 0, '}': 0 };
  for (const ch of url) {
    if (ch in excess) excess[ch]++;
    else if (ch === '(') excess[')']--;
    else if (ch === '[') excess[']']--;
    else if (ch === '{') excess['}']--;
  }
  let end = url.length;
  while (end > 0) {
    const ch = url[end - 1];
    if ('.,;:!?\'"'.includes(ch)) {
      end--;
    } else if (ch in excess && excess[ch] > 0) {
      excess[ch]--;
      end--;
    } else {
      break;
    }
  }
  return url.slice(0, end);
}

/** `text` split into plain runs and http(s) links, in order; joined, the parts are `text`. */
export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const url = trimTrailing(match[0]);
    if (!url.includes('://') || url.endsWith('://')) continue;
    const start = match.index ?? 0;
    if (start > last) parts.push({ text: text.slice(last, start) });
    parts.push({ text: url, href: url });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
