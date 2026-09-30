#!/usr/bin/env node
/**
 * Bring `vendor/ui` up to a newer upstream @mieweb/ui, keeping our changes.
 *
 *   npm run ui:sync              # report only — what has moved, what we carry
 *   npm run ui:sync -- --to v0.11.0   # rebase our commits onto that tag
 *   npm run ui:sync -- --to main      # ...or onto upstream's head
 *
 * The model is a *patch stack*: upstream's history, with our commits replayed
 * on top. `git log <upstream>..HEAD` is therefore the exact list of what we
 * carry, which keeps the cost of a fork visible — every commit there is one
 * more thing to re-apply next time, and one more reason to send it upstream.
 *
 * Rebase rather than merge for the same reason: a merge buries our changes in
 * a history that only grows, while a rebase keeps them a readable stack that
 * shrinks as upstream accepts them.
 *
 * The rebase is left in place on conflict rather than aborted — resolving it is
 * a human job, and throwing away a half-finished one helps nobody. The branch
 * is tagged first, so there is always a way back.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const UI = path.join(ROOT, 'vendor/ui');
const UPSTREAM_URL = 'https://github.com/mieweb/ui';

const log = (...args) => console.log('[ui:sync]', ...args);
const git = (args, opts = {}) =>
  execFileSync('git', args, { cwd: UI, encoding: 'utf8', ...opts }).trim();

if (!fs.existsSync(path.join(UI, 'package.json'))) {
  log('vendor/ui is empty — run `git submodule update --init --recursive` first.');
  process.exit(1);
}

const target = process.argv.includes('--to')
  ? process.argv[process.argv.indexOf('--to') + 1]
  : null;

// A second remote, because `origin` is our fork. Idempotent.
const remotes = git(['remote']).split('\n');
if (!remotes.includes('upstream')) {
  git(['remote', 'add', 'upstream', UPSTREAM_URL]);
  log(`added upstream remote → ${UPSTREAM_URL}`);
}
log('fetching upstream…');
git(['fetch', '--quiet', 'upstream', '--tags']);

/** The newest upstream release tag, by version order. */
const latestTag = git(['tag', '--list', 'v*', '--sort=-v:refname']).split('\n')[0];
const base = git(['merge-base', 'HEAD', 'upstream/main']);
const ours = git(['log', '--oneline', `${base}..HEAD`])
  .split('\n')
  .filter(Boolean);
const behind = git(['rev-list', '--count', `${base}..upstream/main`]);
const current = JSON.parse(fs.readFileSync(path.join(UI, 'package.json'), 'utf8')).version;

console.log('');
log(`vendor/ui is on @mieweb/ui ${current}`);
log(`newest upstream release: ${latestTag}`);
log(`upstream is ${behind} commits ahead of where we branched`);
log(`we carry ${ours.length} change${ours.length === 1 ? '' : 's'} on top:`);
for (const line of ours) console.log(`         ${line}`);
console.log('');

if (!target) {
  log(`report only. To upgrade:  npm run ui:sync -- --to ${latestTag}`);
  process.exit(0);
}

const status = git(['status', '--porcelain']);
if (status) {
  log('vendor/ui has uncommitted changes — commit or stash them first:');
  console.log(status);
  process.exit(1);
}

const backup = `backup/pre-${target.replace(/[^a-z0-9.]/gi, '-')}-${Date.now()}`;
git(['branch', backup]);
log(`safety branch: ${backup}`);

log(`rebasing our ${ours.length} changes onto ${target}…`);
try {
  execFileSync('git', ['rebase', target], { cwd: UI, stdio: 'inherit' });
} catch {
  console.error('');
  log('the rebase stopped on a conflict, and has been left in place.');
  log('resolve it in vendor/ui, then `git rebase --continue`.');
  log(`to abandon it entirely: git rebase --abort (or reset to ${backup})`);
  process.exit(1);
}

log('rebased. Rebuilding…');
execFileSync('npm', ['run', 'build', '-w', '@mieweb/ui'], { cwd: ROOT, stdio: 'inherit' });

console.log('');
log('done. Before committing the new submodule pointer, check:');
log('  1. npm install               — peer ranges may have moved');
log('  2. npx patch-package         — the @kerebron/* patches still apply');
log('  3. npm run typecheck && npm run test:unit');
log('  4. npx playwright test -c tests/playwright.config.ts tests/e2e/huddle');
log('Then push the fork branch FIRST, then commit the pointer here.');
