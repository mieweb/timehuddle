/**
 * What a build was made from, read out of git.
 *
 * The frontend calls this from vite.config.ts at build time and bakes the
 * result into the bundle; the Meteor backend calls it once at startup. Both
 * show up on the About page, so a debug build pushed straight to a phone
 * can be traced back to the exact commits it carries.
 *
 * A build from main is the release line and needs no more than its commit. A
 * build from anywhere else lists what it has that main doesn't — the
 * development work it is carrying.
 *
 * Every git call is allowed to fail — a Docker image or a tarball has no
 * .git — and a field git could not answer is null, never a throw.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** The release line. Builds from it list no commits. */
export const MAIN_BRANCH = 'main';

/** Compared against in this order: the remote's main is what has shipped. */
const MAIN_REFS = [`origin/${MAIN_BRANCH}`, MAIN_BRANCH];

/** How many commits ahead of main to list; the count is always exact. */
export const DEFAULT_COMMIT_LIMIT = 50;

function git(cwd, args) {
  try {
    // safe.directory: prod runs the backend as root out of a user-owned
    // checkout, and git refuses to read a repository someone else owns.
    return execFileSync('git', ['-c', 'safe.directory=*', ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/** The `version` in package.json at the repository's root, if there is one. */
function repoVersion(cwd) {
  const root = git(cwd, ['rev-parse', '--show-toplevel']);
  if (!root) return null;
  try {
    return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

/** The first of MAIN_REFS this clone has, or null (a shallow CI clone may have none). */
function mainRef(cwd) {
  return (
    MAIN_REFS.find((ref) => git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])) ??
    null
  );
}

/**
 * Parse `git log --format=%h%x09%cI%x09%s` output into commits.
 * Exported for tests.
 */
export function parseCommitLog(output) {
  if (!output) return [];
  return output.split('\n').map((line) => {
    const [sha, date, ...subject] = line.split('\t');
    return { sha, date, subject: subject.join('\t') };
  });
}

/**
 * `version` defaults to the root package.json's — the app's version, which the
 * backend's own package.json does not carry.
 *
 * @param {{ cwd?: string, version?: string | null, commitLimit?: number, now?: Date }} [options]
 */
export function readBuildInfo(options = {}) {
  const {
    cwd = process.cwd(),
    version,
    commitLimit = DEFAULT_COMMIT_LIMIT,
    now = new Date(),
  } = options;

  const sha = git(cwd, ['rev-parse', 'HEAD']);
  const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const status = git(cwd, ['status', '--porcelain', '--untracked-files=no']);
  const baseRef = sha ? mainRef(cwd) : null;
  const range = baseRef ? `${baseRef}..HEAD` : null;
  const count = range ? git(cwd, ['rev-list', '--count', '--no-merges', range]) : null;
  const log = range
    ? git(cwd, [
        'log',
        '--no-merges',
        `--max-count=${commitLimit}`,
        '--format=%h%x09%cI%x09%s',
        range,
      ])
    : null;

  return {
    version: version === undefined ? repoVersion(cwd) : version,
    builtAt: now.toISOString(),
    commit: sha,
    commitDate: sha ? git(cwd, ['show', '-s', '--format=%cI', 'HEAD']) : null,
    // A detached HEAD (CI, a worktree on a SHA) reports "HEAD"; that's no branch.
    branch: branch && branch !== 'HEAD' ? branch : null,
    dirty: status === null ? null : status.length > 0,
    baseRef,
    commitsAhead: count === null ? null : Number(count),
    commits: parseCommitLog(log),
  };
}
