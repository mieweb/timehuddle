// Prints a before/after markdown table from two PERF_RESULTS_DIR folders.
// Usage: node tests/performance/compare.mjs <beforeDir> <afterDir>
import { readFileSync } from 'node:fs';
import path from 'node:path';

const [beforeDir, afterDir] = process.argv.slice(2);
if (!beforeDir || !afterDir) {
  console.error('Usage: node tests/performance/compare.mjs <beforeDir> <afterDir>');
  process.exit(1);
}

const load = (dir, name) => {
  try {
    return JSON.parse(readFileSync(path.join(dir, `${name}.json`), 'utf8')).summary;
  } catch {
    return null;
  }
};

// [result file, metric, label, unit]
const ROWS = [
  ['login-page-cold', 'fcp', 'Login page: first contentful paint', 'ms'],
  ['login-page-cold', 'formReady', 'Login page: form usable', 'ms'],
  ['login-page-cold', 'load', 'Login page: load event', 'ms'],
  ['login-page-cold', 'jsTransferKB', 'Login page: JS transferred', 'KB'],
  ['login-page-cold', 'jsDecodedKB', 'Login page: JS parsed', 'KB'],
  ['login-page-cold', 'requests', 'Login page: requests', ''],
  ['login-page-warm', 'fcp', 'Login page, repeat visit: first contentful paint', 'ms'],
  ['login-flow', 'loginToShell', 'Sign in: click to app shell', 'ms'],
  ['login-flow', 'visitToShell', 'Sign in: page visit to app shell', 'ms'],
  ['signup-page-cold', 'fcp', 'Signup page: first contentful paint', 'ms'],
  ['signup-page-cold', 'formReady', 'Signup page: form usable', 'ms'],
  ['signup-flow', 'signupToDialog', 'Sign up: submit to username prompt', 'ms'],
];

// [flow name from definePageFlowTests, label]
const PAGE_FLOWS = [
  ['dashboard', 'Dashboard'],
  ['teams', 'Teams'],
  ['tickets', 'Tickets'],
  ['clock', 'Clock'],
  ['activity', 'Activity'],
  ['settings', 'Settings'],
  ['enterprise', 'Enterprise'],
  ['members', 'Members'],
  ['usage', 'Usage'],
  ['whats-new', "What's New"],
  ['work', 'Work'],
  ['profile', 'Profile'],
  ['profile-work', 'Profile, work tab'],
  ['profile-teammate', 'Teammate profile'],
];

for (const [name, label] of PAGE_FLOWS) {
  ROWS.push(
    [`${name}-signin`, 'signInToReady', `${label}: sign in to ready`, 'ms'],
    [`${name}-returning`, 'visitToReady', `${label}: returning visit to ready`, 'ms'],
    [`${name}-signin`, 'apiCalls', `${label}: API calls`, ''],
    [`${name}-signin`, 'apiDuplicateCalls', `${label}: duplicate API calls`, ''],
    [`${name}-signin`, 'apiDecodedKB', `${label}: API data`, 'KB'],
    [`${name}-signin`, 'wsFrames', `${label}: live-data (DDP) messages`, ''],
    [`${name}-signin`, 'wsKB', `${label}: live-data (DDP) data`, 'KB'],
  );
}

console.log('| Metric | Before | After | Change |\n|---|---:|---:|---:|');
for (const [file, metric, label, unit] of ROWS) {
  const before = load(beforeDir, file)?.[metric];
  const after = load(afterDir, file)?.[metric];
  if (before === undefined || after === undefined) continue;
  const pct = before ? Math.round(((after - before) / before) * 100) : 0;
  const sign = pct > 0 ? '+' : '';
  console.log(`| ${label} | ${before} ${unit} | ${after} ${unit} | ${sign}${pct}% |`);
}
