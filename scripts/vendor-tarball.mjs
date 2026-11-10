/**
 * What the vendor scripts share (vendor-ui.mjs, vendor-pulsevault.mjs).
 *
 * Each one packs a vendor/ submodule into a committed tarball the app installs,
 * and records the commit it was packed from in a marker file, so an unchanged
 * submodule isn't rebuilt. Why a tarball and how to work on a vendored library:
 * vendor/README.md.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ROOT = process.cwd();

/** Run `cmd` in `cwd`; returns its output with `capture`, else streams it live. */
export function sh(cmd, cwd = ROOT, capture = false) {
  // 'inherit' streams output live so a long install or build doesn't look hung.
  return execSync(cmd, { cwd, stdio: capture ? 'pipe' : 'inherit' })
    ?.toString()
    .trim();
}

/** Check the submodule at `path` (from the repo root) out, when it isn't yet. */
export function ensureCheckout(path, log) {
  if (existsSync(join(ROOT, path, '.git'))) return;
  log(`initializing the ${path} submodule…`);
  sh(`git submodule update --init ${path}`);
}

/**
 * The commit the submodule in `dir` is on, and whether `tarball` was already
 * packed from it (`marker` says).
 */
export function tarballState({ dir, tarball, marker }) {
  const commit = sh('git rev-parse HEAD', dir, true);
  const built = existsSync(marker) ? readFileSync(marker, 'utf8').trim() : null;
  return { commit, upToDate: existsSync(tarball) && commit === built };
}

/** `npm pack` the package already built in `dir` into `tarball`. */
export function packInto(dir, tarball) {
  // --ignore-scripts: the build already ran; packing must not rebuild.
  const packed = sh('npm pack --ignore-scripts', dir, true).split('\n').pop().trim();
  renameSync(join(dir, packed), tarball);
}

/**
 * Record the commit `tarball` was packed from. Written last: it is what makes
 * the next run skip the rebuild, so writing it before the lockfiles are
 * refreshed would strand a stale lockfile behind it.
 */
export function markBuilt(marker, commit) {
  writeFileSync(marker, `${commit}\n`);
}
