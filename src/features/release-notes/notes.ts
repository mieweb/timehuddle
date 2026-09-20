/**
 * Loads `release-notes/*.md` into the app.
 *
 * The notes are bundled at build time rather than fetched: the same OTA bundle
 * that carries a change carries the note describing it, so the two can never
 * disagree and the page works with no backend and no network.
 */
import { compareVersions, isNewer } from '@timehuddle/ota-version';

import { parseReleaseNote, versionFromFilename, type ReleaseNote } from './parse';

/** `release-notes/` as seen from this file. */
const NOTES_DIR = '../../../release-notes/';

const RAW_NOTES = import.meta.glob('../../../release-notes/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const ASSET_URLS = import.meta.glob('../../../release-notes/assets/**/*', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** `assets/1.0.2/clock-in.png` → the hashed URL the bundler assigned it. */
const resolveAsset = (relativePath: string): string | null =>
  ASSET_URLS[`${NOTES_DIR}${relativePath}`] ?? null;

export interface LoadedReleaseNotes {
  /** Valid notes, newest version first. */
  notes: ReleaseNote[];
  /** One message per file that failed to parse. Empty in a healthy build. */
  errors: string[];
}

/**
 * Parses every note in the folder.
 *
 * A malformed note is collected rather than thrown so one bad file degrades to
 * a missing entry instead of a blank app — `notes.test.ts` asserts this list is
 * empty for the real folder, which is where a mistake is meant to surface.
 */
export function loadReleaseNotes(
  rawNotes: Record<string, string> = RAW_NOTES,
  assetResolver = resolveAsset,
): LoadedReleaseNotes {
  const notes: ReleaseNote[] = [];
  const errors: string[] = [];

  for (const [path, raw] of Object.entries(rawNotes)) {
    const fileName = path.slice(path.lastIndexOf('/') + 1);
    // README.md and any other non-version file simply isn't a release note.
    if (!versionFromFilename(fileName)) continue;
    try {
      notes.push(parseReleaseNote(fileName, raw, assetResolver));
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  notes.sort((a, b) => compareVersions(b.version, a.version));
  return { notes, errors };
}

/** Every release note in the build, newest first. */
export const releaseNotes: ReleaseNote[] = loadReleaseNotes().notes;

/**
 * Which notes are new *to this user*.
 *
 * Two different questions, depending on what we know:
 *
 *   • They have read the page before — anything published since counts as new.
 *   • They never have — then only releases that happened *after* they signed up
 *     count. Someone who joined today should not be told about the feature they
 *     have only ever known as present, which is why the comparison is strict.
 */
export function unseenReleaseNotes(
  notes: ReleaseNote[],
  seenVersion: string | null | undefined,
  accountCreatedAt: string | null | undefined,
): ReleaseNote[] {
  if (seenVersion) return notes.filter((note) => isNewer(note.version, seenVersion));
  if (!accountCreatedAt) return [];

  const createdAt = new Date(accountCreatedAt);
  if (Number.isNaN(createdAt.getTime())) return [];
  // End-of-day so a release dated the same calendar day a user signed up is
  // treated as already-present rather than as news.
  const cutoff = new Date(`${accountCreatedAt.slice(0, 10)}T23:59:59.999Z`).getTime();
  return notes.filter((note) => new Date(`${note.date}T00:00:00Z`).getTime() > cutoff);
}

export type { ReleaseNote } from './parse';
