#!/usr/bin/env node
/*
 * Applies patches/ (patch-package) after install.
 *
 * The patches fix @kerebron bugs the RichEditor hits; they come from mieweb/ui's
 * own patches/ folder — see patches/README.md. Skips when patch-package or the
 * patches folder is absent: the production Docker stage installs without
 * devDependencies and only serves the already-built dist/.
 */
const { execSync } = require('node:child_process');
const { existsSync } = require('node:fs');

const bin = './node_modules/.bin/patch-package';
if (!existsSync(bin) || !existsSync('./patches')) {
  console.log('[apply-patches] patch-package or patches/ not present – skipping.');
  process.exit(0);
}
execSync(bin, { stdio: 'inherit' });
