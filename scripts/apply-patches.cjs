#!/usr/bin/env node
/*
 * Applies patches/ (patch-package) after install.
 *
 * The patches fix @kerebron bugs the RichEditor hits; they come from mieweb/ui's
 * own patches/ folder — see patches/README.md.
 *
 * The only install allowed to skip is one without patch-package itself: the
 * production Docker stage installs without devDependencies and only serves the
 * already-built dist/. Anywhere else a missing patch, or one that no longer
 * applies, fails the install — an unpatched editor breaks silently.
 */
const { execSync } = require('node:child_process');
const { existsSync } = require('node:fs');

// patch-package applies whatever it finds, so a deleted file would pass
// unnoticed. Keep this list in step with patches/ (see patches/README.md).
const REQUIRED_PATCHES = [
  '@kerebron+extension-codecrock+0.8.12.patch',
  '@kerebron+extension-markdown+0.8.12.patch',
  '@kerebron+extension-menu+0.8.12.patch',
];

const bin = './node_modules/.bin/patch-package';
if (!existsSync(bin)) {
  console.log('[apply-patches] patch-package not installed (production install) – skipping.');
  process.exit(0);
}
const missing = REQUIRED_PATCHES.filter((name) => !existsSync(`./patches/${name}`));
if (missing.length > 0) {
  console.error(
    `[apply-patches] missing from patches/: ${missing.join(', ')} – refusing to install without the Kerebron fixes.`,
  );
  process.exit(1);
}
// --error-on-fail: outside CI patch-package exits 0 even when a patch fails.
execSync(`${bin} --error-on-fail`, { stdio: 'inherit' });
