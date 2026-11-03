#!/usr/bin/env node
/**
 * Guard against building with a stale installed @mieweb/ui (#814).
 *
 * `npm install` (unlike `npm ci`) can leave an already-installed local
 * `file:` tarball dependency untouched even after the tarball on disk
 * changes, as long as the package's own version string doesn't change —
 * `@mieweb/ui` keeps the same version across vendor rebuilds, so this is
 * exactly the situation that broke production Huddle on 2026-11-02: the
 * committed vendor/mieweb-ui.tgz was correct, but the server's node_modules
 * still held an older build.
 *
 * This compares node_modules/@mieweb/ui against the committed tarball
 * file-for-file, independent of version numbers, package-lock.json, or an
 * initialized vendor/ui submodule checkout. Wired as "prebuild" in
 * package.json, so it runs before every `npm run build` — in CI and in the
 * production deploy scripts that rebuild on the target host.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.cwd();
const DEFAULT_TARBALL = join(ROOT, 'vendor/mieweb-ui.tgz');
const DEFAULT_INSTALLED_DIR = join(ROOT, 'node_modules/@mieweb/ui');

/** Sorted, posix-style relative file paths under `dir`, skipping nested node_modules. */
function walk(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        out.push(relative(dir, full).split(sep).join('/'));
      }
    }
  }
  return out.sort();
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Extracts an npm tarball and returns the path to its top-level "package" dir. */
function extractTarball(tarballPath, destDir) {
  execFileSync('tar', ['-xzf', tarballPath, '-C', destDir]);
  return join(destDir, 'package');
}

/**
 * Compares an installed @mieweb/ui directory against the committed tarball.
 * Pure (no process.exit) so it can be exercised directly in tests.
 */
export function compareUiInstall({
  tarballPath = DEFAULT_TARBALL,
  installedDir = DEFAULT_INSTALLED_DIR,
} = {}) {
  if (!existsSync(tarballPath)) {
    return { ok: true, skipped: true, message: `No tarball at ${tarballPath} — skipping check.` };
  }
  if (!existsSync(installedDir) || !statSync(installedDir).isDirectory()) {
    return {
      ok: false,
      skipped: false,
      missing: [],
      extra: [],
      changed: [],
      message: `${installedDir} is missing. Run "npm install" before building.`,
    };
  }

  const tmp = mkdtempSync(join(tmpdir(), 'ui-tarball-check-'));
  try {
    const extracted = extractTarball(tarballPath, tmp);
    const tarballFiles = walk(extracted);
    const installedFiles = walk(installedDir);
    const tarballSet = new Set(tarballFiles);
    const installedSet = new Set(installedFiles);

    const missing = tarballFiles.filter((f) => !installedSet.has(f));
    const extra = installedFiles.filter((f) => !tarballSet.has(f));
    const changed = tarballFiles
      .filter((f) => installedSet.has(f))
      .filter((f) => {
        const a = readFileSync(join(extracted, f));
        const b = readFileSync(join(installedDir, f));
        return sha256(a) !== sha256(b);
      });

    const ok = missing.length === 0 && extra.length === 0 && changed.length === 0;
    return { ok, skipped: false, missing, extra, changed };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function formatReport(result) {
  const lines = [
    'Installed node_modules/@mieweb/ui does not match the committed vendor/mieweb-ui.tgz.',
    '',
    'This is the exact failure mode behind #814: an incremental "npm install" left a stale',
    'build of @mieweb/ui in place even though the committed tarball is correct.',
    '',
    'Fix it with a clean reinstall:',
    '  rm -rf node_modules/@mieweb/ui node_modules/.package-lock.json',
    '  npm install',
    '(or, for a fully clean install: rm -rf node_modules && npm ci)',
    '',
  ];
  if (result.missing?.length) {
    lines.push(`Missing from the installed copy (${result.missing.length}):`);
    lines.push(...result.missing.slice(0, 10).map((f) => `  - ${f}`));
    if (result.missing.length > 10) lines.push(`  ... and ${result.missing.length - 10} more`);
  }
  if (result.extra?.length) {
    lines.push(`Present only in the installed copy (${result.extra.length}):`);
    lines.push(...result.extra.slice(0, 10).map((f) => `  - ${f}`));
    if (result.extra.length > 10) lines.push(`  ... and ${result.extra.length - 10} more`);
  }
  if (result.changed?.length) {
    lines.push(`Different content (${result.changed.length}):`);
    lines.push(...result.changed.slice(0, 10).map((f) => `  - ${f}`));
    if (result.changed.length > 10) lines.push(`  ... and ${result.changed.length - 10} more`);
  }
  return lines.join('\n');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const result = compareUiInstall();
  if (result.skipped) {
    console.log(`[check-ui-tarball] ${result.message}`);
  } else if (!result.ok) {
    console.error(`[check-ui-tarball] ${result.message ?? formatReport(result)}`);
    process.exit(1);
  } else {
    console.log('[check-ui-tarball] installed @mieweb/ui matches vendor/mieweb-ui.tgz');
  }
}
