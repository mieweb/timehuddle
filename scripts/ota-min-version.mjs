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
import { isValidVersion } from '@timehuddle/ota-version';

import { arg, fail, resolveChannel } from './ota-cli.mjs';

const { channel, token, backend } = resolveChannel();

const clear = process.argv.includes('--clear');
const version = clear ? '' : arg('version');
if (!clear && !isValidVersion(version)) {
  fail(`Invalid --version "${version}" — expected semver like 1.0.3 (or pass --clear)`);
}

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
