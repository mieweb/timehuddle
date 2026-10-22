/**
 * Outside IDs (#689): the short name an issue in another system goes by,
 * worked out from its address.
 *
 * - A GitHub issue or pull request is `<repo>-<number>`, e.g. `timehuddle-223`,
 *   with no setup.
 * - An address on a server the organization has named is `<prefix>-<number>`,
 *   e.g. `PM-233` for `https://redmine.example.com/issues/233`.
 *
 * Pure, so every surface names an issue the same way.
 */
import type { SourcePrefix } from '../../lib/api';

import { parseGithubIssueUrl } from './githubIssue';

/** A number at the end of the path, before any query or fragment. */
const TRAILING_NUMBER = /\/(\d+)\/?$/;

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** The outside ID for `url`, or null when it is not one we can name. */
export function outsideIdOf(
  url: string | null | undefined,
  prefixes: readonly SourcePrefix[],
): string | null {
  if (!url) return null;
  const parsed = parseUrl(url.trim());
  if (!parsed) return null;
  const host = parsed.hostname.toLowerCase();

  if (host === 'github.com' || host === 'www.github.com') {
    const parts = parseGithubIssueUrl(parsed.href);
    return parts ? `${parts.repo}-${parts.number}` : null;
  }

  const named = prefixes.find((entry) => entry.host === host);
  const number = parsed.pathname.match(TRAILING_NUMBER)?.[1];
  return named && number ? `${named.prefix}-${number}` : null;
}

/** The number at the end of a ref, `233` in `PM-233` or `#233`, or null. */
export function refNumber(ref: string): string | null {
  return ref.match(/(\d+)$/)?.[1] ?? null;
}
