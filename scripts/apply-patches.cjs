#!/usr/bin/env node
/*
 * Applies patches/ (patch-package) after install.
 *
 * The patches fix @kerebron bugs the RichEditor hits; they come from mieweb/ui's
 * own patches/ folder — see patches/README.md.
 *
 * The only install allowed to skip is one without patch-package itself: the
 * production Docker stage installs without devDependencies and only serves the
 * already-built dist/. Anywhere else a missing patches/ folder or a patch that
 * no longer applies fails the install — an unpatched editor breaks silently.
 */
const { execSync } = require('node:child_process');
const { existsSync } = require('node:fs');

const bin = './node_modules/.bin/patch-package';
if (!existsSync(bin)) {
  console.log('[apply-patches] patch-package not installed (production install) – skipping.');
  process.exit(0);
}
if (!existsSync('./patches')) {
  console.error(
    '[apply-patches] patches/ is missing – refusing to install without the Kerebron fixes.',
  );
  process.exit(1);
}
// --error-on-fail: outside CI patch-package exits 0 even when a patch fails.
execSync(`${bin} --error-on-fail`, { stdio: 'inherit' });
