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
  ['dashboard-signin', 'signInToReady', 'Dashboard: sign in to ready', 'ms'],
  ['dashboard-returning', 'visitToReady', 'Dashboard: returning visit to ready', 'ms'],
  ['dashboard-signin', 'apiCalls', 'Dashboard: API calls', ''],
  ['dashboard-signin', 'apiDuplicateCalls', 'Dashboard: duplicate API calls', ''],
  ['dashboard-signin', 'apiDecodedKB', 'Dashboard: API data', 'KB'],
  ['dashboard-signin', 'wsFrames', 'Dashboard: live-data (DDP) messages', ''],
  ['dashboard-signin', 'wsKB', 'Dashboard: live-data (DDP) data', 'KB'],
  ['teams-signin', 'signInToReady', 'Teams: sign in to ready', 'ms'],
  ['teams-returning', 'visitToReady', 'Teams: returning visit to ready', 'ms'],
  ['teams-signin', 'apiCalls', 'Teams: API calls', ''],
  ['teams-signin', 'apiDuplicateCalls', 'Teams: duplicate API calls', ''],
  ['teams-signin', 'apiDecodedKB', 'Teams: API data', 'KB'],
  ['teams-signin', 'wsFrames', 'Teams: live-data (DDP) messages', ''],
  ['teams-signin', 'wsKB', 'Teams: live-data (DDP) data', 'KB'],
  ['tickets-signin', 'signInToReady', 'Tickets: sign in to ready', 'ms'],
  ['tickets-returning', 'visitToReady', 'Tickets: returning visit to ready', 'ms'],
  ['tickets-signin', 'apiCalls', 'Tickets: API calls', ''],
  ['tickets-signin', 'apiDuplicateCalls', 'Tickets: duplicate API calls', ''],
  ['tickets-signin', 'apiDecodedKB', 'Tickets: API data', 'KB'],
  ['tickets-signin', 'wsFrames', 'Tickets: live-data (DDP) messages', ''],
  ['tickets-signin', 'wsKB', 'Tickets: live-data (DDP) data', 'KB'],
];

console.log('| Metric | Before | After | Change |\n|---|---:|---:|---:|');
for (const [file, metric, label, unit] of ROWS) {
  const before = load(beforeDir, file)?.[metric];
  const after = load(afterDir, file)?.[metric];
  if (before === undefined || after === undefined) continue;
  const pct = before ? Math.round(((after - before) / before) * 100) : 0;
  const sign = pct > 0 ? '+' : '';
  console.log(`| ${label} | ${before} ${unit} | ${after} ${unit} | ${sign}${pct}% |`);
}
