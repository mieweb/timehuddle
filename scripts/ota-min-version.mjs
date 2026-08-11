#!/usr/bin/env node
/**
 * Set (or clear) the minimum bundle version a channel will accept.
 *
 *   node scripts/ota-min-version.mjs --channel testflight --version 1.0.3
 *   node scripts/ota-min-version.mjs --channel testflight --clear
 *
 * Clients running older than --version are held at a blocking update screen
 * until they download the latest bundle. This is the kill switch for a bad
 * release: it needs no rebuild and no republish.
 */
import fs from 'fs';
import path from 'path';

const DEFAULT_BACKENDS = {
  testflight: 'https://timecore-dev.os.mieweb.org',
  production: 'https://timecore-prod.os.mieweb.org',
};

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

/** Load KEY=VALUE pairs from .env.<channel> and .env.local (no-op if absent). */
function loadEnvFile(channel) {
  const root = new URL('..', import.meta.url).pathname;
  for (const name of [`.env.${channel}`, '.env.local']) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
      if (!(key in process.env)) process.env[key] = val;
    }
  }
}

const channel = arg('channel');
if (!Object.keys(DEFAULT_BACKENDS).includes(channel)) {
  fail(`--channel must be one of: ${Object.keys(DEFAULT_BACKENDS).join(', ')}`);
}

loadEnvFile(channel);

const clear = process.argv.includes('--clear');
const version = clear ? '' : arg('version');
if (!clear && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version || '')) {
  fail(`Invalid --version "${version}" — expected semver like 1.0.3 (or pass --clear)`);
}

const token = process.env.OTA_PUBLISH_TOKEN;
if (!token) fail(`OTA_PUBLISH_TOKEN is not set — add it to .env.${channel} or pass it inline`);

const backend = (process.env.OTA_BACKEND_URL || DEFAULT_BACKENDS[channel]).replace(/\/+$/, '');

const res = await fetch(
  `${backend}/ota/min-version?channel=${channel}&version=${encodeURIComponent(version)}`,
  { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
);

const text = await res.text();
if (!res.ok) fail(`Request failed (${res.status}): ${text}`);

const manifest = JSON.parse(text);
console.log(
  clear
    ? `✔ Cleared the ${channel} minimum version gate`
    : `✔ ${channel} now requires v${manifest.minVersion} — older clients must update to v${manifest.version}`,
);
