#!/usr/bin/env node
/**
 * Build and sync the vendored @mieweb/ui (the vendor/ui submodule).
 *
 * vendor/ui tracks a branch on our fork of mieweb/ui where SuperChat changes
 * are prototyped as an upstream PR; TimeHuddle consumes it as the committed
 * vendor/mieweb-ui.tgz (`"@mieweb/ui": "file:vendor/mieweb-ui.tgz"`).
 *
 *   npm run ui:build   rebuild the tarball from vendor/ui's current commit
 *   npm run ui:sync    merge upstream mieweb/ui main into the branch, then build
 *
 * Why a tarball and not `file:vendor/ui`: a linked folder keeps its own
 * node_modules, so TypeScript sees two @types/react copies and every component
 * prop collapses to `any`. A packed tarball installs flat like any npm package.
 * CI and Docker only need the committed tarball, never the submodule.
 * History: .attic/mieweb-ui-tarball/README.md.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const UI_DIR = join(ROOT, 'vendor/ui');
const TARBALL = join(ROOT, 'vendor/mieweb-ui.tgz');
const MARKER = join(ROOT, 'vendor/.ui-tarball-commit');
const UPSTREAM_URL = 'https://github.com/mieweb/ui.git';

const log = (msg) => console.log(`[vendor-ui] ${msg}`);

function sh(cmd, cwd = ROOT, capture = false) {
  // 'inherit' streams output live so the long pnpm/tsup steps don't look hung.
  return execSync(cmd, { cwd, stdio: capture ? 'pipe' : 'inherit' })
    ?.toString()
    .trim();
}

function ensureCheckout() {
  if (existsSync(join(UI_DIR, '.git'))) return;
  log('initializing the vendor/ui submodule…');
  sh('git submodule update --init vendor/ui');
}

/**
 * Put vendor/ui on the branch `.gitmodules` tracks.
 *
 * `git submodule update` checks out the recorded commit on a detached HEAD —
 * the `branch` setting does not attach it. A merge made there has no branch to
 * push, so the documented `git -C vendor/ui push` would fail.
 */
function ensureBranch() {
  const branch = sh('git config -f .gitmodules submodule.vendor/ui.branch', ROOT, true);
  if (!branch) throw new Error('.gitmodules has no branch for vendor/ui.');
  if (sh('git rev-parse --abbrev-ref HEAD', UI_DIR, true) === branch) return;
  log(`vendor/ui is detached — checking out ${branch}`);
  sh(`git checkout ${branch}`, UI_DIR);
}

/** Merge upstream main into the PR branch (a merge, so no force-push is needed). */
function sync() {
  ensureCheckout();
  if (sh('git status --porcelain', UI_DIR, true)) {
    throw new Error('vendor/ui has uncommitted changes — commit or stash them first.');
  }
  ensureBranch();
  const remotes = sh('git remote', UI_DIR, true).split('\n');
  if (!remotes.includes('upstream')) sh(`git remote add upstream ${UPSTREAM_URL}`, UI_DIR);
  sh('git fetch upstream main', UI_DIR);
  sh('git merge --no-edit upstream/main', UI_DIR);
  log('merged upstream/main. Push the branch to the fork when ready: git -C vendor/ui push');
}

function build({ force }) {
  ensureCheckout();
  const commit = sh('git rev-parse HEAD', UI_DIR, true);
  const built = existsSync(MARKER) ? readFileSync(MARKER, 'utf8').trim() : null;
  if (!force && existsSync(TARBALL) && commit === built) {
    log(`up to date (${commit.slice(0, 8)}) — skipping rebuild`);
    return;
  }

  log(`building ${commit.slice(0, 8)} — this takes a few minutes…`);
  // mieweb/ui's own submodules (datavis, esheet, ychart) feed its build.
  sh('git submodule update --init', UI_DIR);
  // pnpm, never npm: an npm install there leaves duplicate deps and phantom tsc
  // errors. Its `prepare` builds datavis and the CSS bundles.
  sh('pnpm install --frozen-lockfile', UI_DIR);
  sh('pnpm run build', UI_DIR);
  // --ignore-scripts: `prepare` already ran above; packing must not rebuild.
  const packed = sh('npm pack --ignore-scripts', UI_DIR, true).split('\n').pop().trim();
  renameSync(join(UI_DIR, packed), TARBALL);

  // package-lock.json pins the tarball's checksum, so refresh it — otherwise
  // `npm ci` (CI, Docker) fails with EINTEGRITY on the next run.
  sh('npm install --no-audit --no-fund @mieweb/ui@file:vendor/mieweb-ui.tgz');
  // Last: the marker is what makes the next run skip the rebuild, so writing
  // it before the install above would strand a stale lockfile behind it.
  writeFileSync(MARKER, `${commit}\n`);
  log(`vendor/mieweb-ui.tgz rebuilt from ${commit.slice(0, 8)}. Commit it with package-lock.json.`);
}

const [command = 'build', ...flags] = process.argv.slice(2);
try {
  if (command === 'sync') {
    sync();
    build({ force: false });
  } else if (command === 'build') {
    build({ force: flags.includes('--force') });
  } else {
    throw new Error(`unknown command "${command}" — use build or sync`);
  }
} catch (err) {
  console.error(`[vendor-ui] ${err.message}`);
  process.exit(1);
}
