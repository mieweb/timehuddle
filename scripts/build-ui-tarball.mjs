#!/usr/bin/env node
/**
 * Keeps vendor/mieweb-ui.tgz in sync with the vendor/ui submodule.
 *
 * @mieweb/ui is installed from a packed tarball (not a raw file:vendor/ui link)
 * because linking the submodule directly gives it its own node_modules tree —
 * TypeScript then sees two distinct copies of @types/react and every component's
 * props collapse to `any`. Packing through `npm pack` flattens it into a single
 * shared node_modules copy like any other npm dependency, avoiding that.
 *
 * Skips the rebuild when vendor/ui's commit hasn't changed since the tarball was
 * last built, so `npm run dev`/`build` stay fast on unchanged submodule state.
 * Set SKIP_UI_BUILD=1 to bypass entirely (e.g. CI using a pre-built tarball).
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const UI_DIR = join(ROOT, 'vendor/ui');
const TARBALL = join(ROOT, 'vendor/mieweb-ui.tgz');
const MARKER = join(ROOT, 'vendor/.ui-tarball-commit');

function sh(cmd, cwd = ROOT, capture = false) {
  // 'inherit' streams output live so long-running pnpm/tsup steps don't look hung.
  return execSync(cmd, { cwd, stdio: capture ? 'pipe' : 'inherit' })
    ?.toString()
    .trim();
}

if (process.env.SKIP_UI_BUILD === '1') {
  console.log('[build-ui-tarball] SKIP_UI_BUILD=1 — leaving existing tarball as-is');
  process.exit(0);
}

if (!existsSync(join(UI_DIR, '.git'))) {
  if (existsSync(TARBALL)) {
    console.log('[build-ui-tarball] vendor/ui submodule not checked out — using existing tarball');
    process.exit(0);
  }
  console.log('[build-ui-tarball] initializing vendor/ui submodule...');
  sh('git submodule update --init vendor/ui');
}

const currentCommit = sh('git rev-parse HEAD', UI_DIR, true);
const lastBuiltCommit = existsSync(MARKER) ? readFileSync(MARKER, 'utf8').trim() : null;

if (existsSync(TARBALL) && currentCommit === lastBuiltCommit) {
  console.log(`[build-ui-tarball] up to date (${currentCommit.slice(0, 8)}) — skipping rebuild`);
  process.exit(0);
}

console.log(`[build-ui-tarball] vendor/ui changed (${lastBuiltCommit?.slice(0, 8) ?? 'none'} -> ${currentCommit.slice(0, 8)}), rebuilding — this can take a few minutes...`);
sh('pnpm install', UI_DIR);
sh('pnpm run build', UI_DIR);
const packOutput = sh('npm pack', UI_DIR, true);
const packedFile = packOutput.split('\n').pop().trim();
renameSync(join(UI_DIR, packedFile), TARBALL);
writeFileSync(MARKER, currentCommit + '\n');

console.log(`[build-ui-tarball] rebuilt vendor/mieweb-ui.tgz from ${currentCommit.slice(0, 8)}`);
