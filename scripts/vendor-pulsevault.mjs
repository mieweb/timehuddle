#!/usr/bin/env node
/**
 * Build the vendored @mieweb/pulsevault (the vendor/pulsevault submodule).
 *
 * vendor/pulsevault is mieweb/pulsevault at the commit TimeHuddle runs: a
 * release, or changes waiting on one. The app and meteor-backend install it as
 * the committed vendor/mieweb-pulsevault.tgz
 * (`"@mieweb/pulsevault": "file:vendor/mieweb-pulsevault.tgz"`, and
 * `"file:../vendor/mieweb-pulsevault.tgz"`), never as a link to the folder: a
 * linked folder brings its own node_modules and devDependencies into both
 * lockfiles, and has to be checked out and built wherever anything installs.
 * CI, Docker and the deploys only need the committed tarball.
 *
 *   npm run pv:build              pack the tarball from vendor/pulsevault's commit
 *   npm run pv:build -- --force   again, though the commit hasn't moved
 *
 * The workflow is in vendor/README.md.
 */
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { ensureCheckout, markBuilt, packInto, ROOT, sh, tarballState } from './vendor-tarball.mjs';

const SUBMODULE = 'vendor/pulsevault';
const DIR = join(ROOT, SUBMODULE);
const TARBALL = join(ROOT, 'vendor/mieweb-pulsevault.tgz');
const MARKER = join(ROOT, 'vendor/.pulsevault-tarball-commit');

const log = (msg) => console.log(`[vendor-pulsevault] ${msg}`);

function build({ force }) {
  ensureCheckout(SUBMODULE, log);
  const { commit, upToDate } = tarballState({ dir: DIR, tarball: TARBALL, marker: MARKER });
  if (!force && upToDate) {
    log(`up to date (${commit.slice(0, 8)}) — skipping rebuild`);
    return;
  }

  log(`building ${commit.slice(0, 8)}…`);
  sh('npm ci --no-audit --no-fund', DIR);
  // tsc leaves the output of a source file that no longer exists: start clean,
  // so the tarball is this commit's build and nothing else.
  rmSync(join(DIR, 'dist'), { recursive: true, force: true });
  sh('npm run build', DIR);
  packInto(DIR, TARBALL);

  // Both lockfiles pin the tarball's checksum, so refresh them — otherwise
  // `npm ci` (CI, Docker) fails with EINTEGRITY on the next run. The app's is
  // installed too. meteor-backend's is only written: installing under a running
  // Meteor breaks it, so that one is for whoever runs the backend.
  sh('npm install --no-audit --no-fund @mieweb/pulsevault@file:vendor/mieweb-pulsevault.tgz');
  sh(
    'npm install --package-lock-only --no-audit --no-fund @mieweb/pulsevault@file:../vendor/mieweb-pulsevault.tgz',
    join(ROOT, 'meteor-backend'),
  );
  markBuilt(MARKER, commit);
  log(`vendor/mieweb-pulsevault.tgz rebuilt from ${commit.slice(0, 8)}.`);
  log('Commit it with both package-lock.json files, the marker and the submodule pointer.');
  // ci, not install: Meteor's own npm is older and rewrites the lockfile it is given.
  log('Then, with the backend stopped: cd meteor-backend && meteor npm ci');
}

const flags = process.argv.slice(2);
try {
  const unknown = flags.find((flag) => flag !== '--force');
  if (unknown) throw new Error(`unknown option "${unknown}" — the only one is --force`);
  build({ force: flags.includes('--force') });
} catch (err) {
  console.error(`[vendor-pulsevault] ${err.message}`);
  process.exit(1);
}
