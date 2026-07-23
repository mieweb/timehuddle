#!/usr/bin/env node
/**
 * ensure-ui-build.mjs — postinstall guard for the @mieweb/ui submodule.
 *
 * The app depends on "@mieweb/ui": "file:vendor/ui", which npm links as-is —
 * after a fresh clone the submodule is empty and dist/ doesn't exist, so the
 * app would fail at import time with no obvious cause. This script makes
 * `npm install` self-healing: it initializes the submodule and builds the
 * library once, and is a fast no-op when dist/ is already present.
 *
 * Skip with SKIP_UI_BUILD=1 (e.g. CI legs that don't run the frontend).
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uiDir = path.join(root, 'vendor', 'ui');
const artifact = path.join(uiDir, 'dist', 'index.js');

if (process.env.SKIP_UI_BUILD === '1') {
  console.log('[ensure-ui-build] SKIP_UI_BUILD=1 — skipping');
  process.exit(0);
}

if (existsSync(artifact)) {
  process.exit(0); // already built
}

const run = (cmd, cwd = root) => {
  console.log(`[ensure-ui-build] ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
};

try {
  if (!existsSync(path.join(uiDir, 'package.json'))) {
    run('git submodule update --init vendor/ui');
  }
  run('npm install', uiDir);
  run('npm run build', uiDir);
  console.log('[ensure-ui-build] @mieweb/ui built at vendor/ui/dist');
} catch (err) {
  console.error(
    '[ensure-ui-build] failed to build vendor/ui — the app will not start until it is built.\n' +
      'Run manually: git submodule update --init vendor/ui && cd vendor/ui && npm install && npm run build',
  );
  throw err;
}
