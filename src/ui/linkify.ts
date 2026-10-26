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

const URL_RE = /https?:\/\/[^\s<>"]+/g;

const count = (s: string, ch: string) => s.split(ch).length - 1;

/**
 * Punctuation that ends a sentence rather than the URL ("see https://x.dev.").
 * A closing bracket only counts when the URL hasn't opened one for it, so a
 * Wikipedia-style `…/Foo_(bar)` keeps its `)`, and `(…/Foo_(bar))` keeps only
 * the one it opened.
 */
function trimTrailing(url: string): string {
  let end = url.length;
  while (end > 0) {
    const ch = url[end - 1];
    const head = url.slice(0, end);
    if ('.,;:!?\'"'.includes(ch)) {
      end--;
    } else if (ch === ')' && count(head, ')') > count(head, '(')) {
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
