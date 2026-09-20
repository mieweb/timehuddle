/**
 * Parsing for a single `release-notes/<version>.md` file.
 *
 * Kept free of `import.meta.glob` (which only resolves inside a Vite build) so
 * the rules a note has to satisfy can be unit-tested against strings, and so
 * `notes.ts` can run the very same parser over the real folder.
 *
 * The parser is deliberately strict and throws rather than degrading: a note
 * with a mistyped version or a screenshot path that points at nothing is a
 * mistake to catch in `npm test`, not a broken image to ship to a phone.
 */
import { isValidVersion } from '@timehuddle/ota-version';

export interface ReleaseNote {
  /** Semver, equal to the file's own basename. */
  version: string;
  /** `YYYY-MM-DD` — the day the release ships. */
  date: string;
  /** User-facing headline for the release. */
  title: string;
  /**
   * Markdown body, ready to render: relative asset paths rewritten to bundled
   * URLs, and every heading pushed down one level to nest under the release
   * title the page renders from `title`.
   */
  body: string;
}

/**
 * Resolves an asset path as written in a note (`assets/1.0.2/clock-in.png`) to
 * the URL the bundler gave it, or `null` when no such file exists.
 */
export type AssetResolver = (relativePath: string) => string | null;

/** Files named anything else (README.md, notes-in-progress) are not releases. */
const NOTE_FILENAME_RE = /^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.md$/;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Markdown image/link targets pointing into the release-notes asset folder.
 * Anchored on `assets/` because that is the only path a note may reference —
 * absolute URLs (YouTube, docs links) are left exactly as written.
 */
const ASSET_REF_RE = /(!?\[[^\]]*\]\()(assets\/[^)\s]+)(\)|\s)/g;

/** The version a release-notes filename declares, or null if it isn't one. */
export function versionFromFilename(fileName: string): string | null {
  return NOTE_FILENAME_RE.exec(fileName)?.[1] ?? null;
}

/** Minimal `key: value` frontmatter — notes never need nesting or lists. */
function parseFrontmatter(block: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return fields;
}

/**
 * Points every `assets/…` reference at its hashed build URL.
 *
 * Throws on a reference the bundler never saw, which is almost always a typo or
 * a screenshot that was written about but never committed.
 */
function rewriteAssetPaths(body: string, fileName: string, resolveAsset: AssetResolver): string {
  return body.replace(ASSET_REF_RE, (_match, prefix: string, path: string, suffix: string) => {
    const url = resolveAsset(path);
    if (!url) {
      throw new Error(`${fileName}: references "${path}", which does not exist in release-notes/`);
    }
    return `${prefix}${url}${suffix}`;
  });
}

/**
 * Pushes every heading in the body down one level.
 *
 * The release's own `title` is rendered as the `h2` heading its card is labelled
 * by, so a note's `##` sections have to land at `h3` to nest under it. Left
 * alone they would read to a screen reader as siblings of the *next* release's
 * title, with no way to tell where one release ends.
 *
 * Fenced blocks are skipped — a `# comment` on the first line of a shell
 * snippet is not a heading.
 */
function demoteHeadings(body: string): string {
  let inFence = false;
  return body
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      // h6 is the floor; markdown has nowhere lower to push it.
      return line.replace(/^(#{1,5})(\s)/, '#$1$2');
    })
    .join('\n');
}

/**
 * Parses one note file. `fileName` is the basename (`1.0.2.md`) and doubles as
 * the authority on the version — the frontmatter has to agree with it.
 */
export function parseReleaseNote(
  fileName: string,
  raw: string,
  resolveAsset: AssetResolver = () => null,
): ReleaseNote {
  const expectedVersion = versionFromFilename(fileName);
  if (!expectedVersion) {
    throw new Error(`${fileName}: filename must be a version, like "1.0.2.md"`);
  }

  const frontmatter = FRONTMATTER_RE.exec(raw);
  if (!frontmatter) {
    throw new Error(`${fileName}: missing the "---" frontmatter block`);
  }
  const fields = parseFrontmatter(frontmatter[1]);
  const { version, date, title } = fields;

  if (!version) throw new Error(`${fileName}: frontmatter is missing "version"`);
  if (!isValidVersion(version)) {
    throw new Error(`${fileName}: "${version}" is not a version — expected semver like 1.0.2`);
  }
  if (version !== expectedVersion) {
    throw new Error(`${fileName}: declares version "${version}" but is named "${fileName}"`);
  }
  if (!date) throw new Error(`${fileName}: frontmatter is missing "date"`);
  if (!DATE_RE.test(date)) throw new Error(`${fileName}: date "${date}" is not YYYY-MM-DD`);
  if (Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new Error(`${fileName}: date "${date}" is not a real calendar date`);
  }
  if (!title) throw new Error(`${fileName}: frontmatter is missing "title"`);

  const body = raw.slice(frontmatter[0].length).trim();
  if (!body) throw new Error(`${fileName}: has no body below the frontmatter`);

  return {
    version,
    date,
    title,
    body: demoteHeadings(rewriteAssetPaths(body, fileName, resolveAsset)),
  };
}
