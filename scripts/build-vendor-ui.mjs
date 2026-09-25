#!/usr/bin/env node
/**
 * Build the vendored @mieweb/ui (vendor/ui) if what's on disk is stale.
 *
 * `vendor/ui` is our fork of mieweb/ui, checked out as a git submodule and
 * linked as an npm workspace, so `node_modules/@mieweb/ui` is a symlink to it
 * and the app imports its `dist/` directly. `dist/` is not in git — it is build
 * output — so something has to produce it, and issue #517's whole complaint
 * about the previous arrangement was that the "something" was a human who had
 * to remember. This runs on `postinstall`, so a fresh clone, a `npm install`,
 * and a submodule bump all leave the app building against current sources.
 *
 * Skips quietly when the build is newer than every input, so the common case
 * (install with nothing changed) costs a directory walk rather than a rebuild.
 *
 * Exits 0 when the submodule is absent. `npm install` runs this on machines
 * that have not initialised submodules yet, and failing the install there would
 * be a worse first experience than the clear warning printed below — the very
 * next command that touches @mieweb/ui says the same thing more loudly.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const UI = path.join(ROOT, 'vendor/ui');
const BUILD_MARKER = path.join(UI, 'dist/kerebron.js');
/** Inputs that can invalidate the build. `dist` and `node_modules` are output. */
const SOURCES = ['src', 'package.json', 'tsup.config.ts'];

const log = (...args) => console.log('[vendor-ui]', ...args);

if (!fs.existsSync(path.join(UI, 'package.json'))) {
  log(
    'vendor/ui is empty — skipping the @mieweb/ui build.\n' +
      '           Run `git submodule update --init --recursive` and `npm install` again.',
  );
  process.exit(0);
}

/** Most recent mtime under a path, or 0 when it does not exist. */
function newestMtime(target) {
  if (!fs.existsSync(target)) return 0;
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return fs
    .readdirSync(target, { withFileTypes: true })
    .reduce((newest, entry) => Math.max(newest, newestMtime(path.join(target, entry.name))), 0);
}

const builtAt = newestMtime(BUILD_MARKER);
const sourcedAt = Math.max(...SOURCES.map((source) => newestMtime(path.join(UI, source))));

if (builtAt > sourcedAt) {
  log('build is current — nothing to do');
  process.exit(0);
}

log(builtAt === 0 ? 'no build found — building @mieweb/ui…' : 'sources changed — rebuilding…');
try {
  execFileSync('npm', ['run', 'build', '-w', '@mieweb/ui'], { cwd: ROOT, stdio: 'inherit' });
  log('built');
} catch {
  // Loud, but not fatal to the install: the app fails clearly on the next
  // typecheck or dev server start, with the real build output already printed.
  console.error('[vendor-ui] BUILD FAILED — @mieweb/ui is stale or missing.');
  process.exit(1);
}
