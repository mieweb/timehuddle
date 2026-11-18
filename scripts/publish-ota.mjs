#!/usr/bin/env node
/**
 * Publish the current dist/ as an OTA bundle to the self-hosted update endpoint.
 *
 *   node scripts/publish-ota.mjs --channel testflight [--version 1.0.1] [--min-version 1.0.1]
 *                                [--native-floor 1.2.0]
 *
 * Env:
 *   OTA_BACKEND_URL    backend base URL (defaults per channel, see below)
 *   OTA_PUBLISH_TOKEN  bearer token matching the backend's OTA_PUBLISH_TOKEN
 *
 * The bundle version must be greater than the native app version (iOS
 * MARKETING_VERSION / Android versionName) or devices will treat it as stale.
 *
 * --min-version gates clients: anything older is held at a blocking update
 * screen until it downloads. Omit it to leave the existing gate untouched.
 *
 * --native-floor is the lowest native app version this bundle runs on. Raise it
 * only for a breaking web ↔ native change (web code that calls a plugin or
 * native API older shells lack). Shells below it keep getting the newest bundle
 * published at a floor they meet. Omit it to keep the floor already in force;
 * it carries over to every later bundle, like --min-version.
 *
 * Once a floor is in force, --min-version (and ota-min-version.mjs) reaches only
 * shells at the newest floor whose running bundle sends its native build to
 * /ota/latest; the rest are never gated onto a bundle they cannot run. To
 * replace a bad bundle an older floor still serves, publish a fix with
 * --native-floor set to that floor, then pass the higher floor again on the
 * next publish.
 */
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';

import { isNewer, isValidVersion } from '@timehuddle/ota-version';

import { arg, fail, resolveChannel } from './ota-cli.mjs';

const { channel, token, backend } = resolveChannel();

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const version = arg('version') || pkg.version;
if (!isValidVersion(version)) {
  fail(`Invalid bundle version "${version}" — expected semver like 1.0.1`);
}

const minVersion = arg('min-version');
if (minVersion !== undefined && !isValidVersion(minVersion)) {
  fail(`Invalid --min-version "${minVersion}" — expected semver like 1.0.1`);
}

const nativeFloor = arg('native-floor');
if (nativeFloor !== undefined && !/^\d+\.\d+\.\d+$/.test(nativeFloor)) {
  fail(`Invalid --native-floor "${nativeFloor}" — expected a native app version like 1.2.0`);
}
// Devices skip a bundle at or below their native version, so one below its own
// floor would never reach a shell that can run it.
if (nativeFloor !== undefined && isNewer(nativeFloor, version)) {
  fail(`--native-floor ${nativeFloor} cannot exceed the bundle version ${version}`);
}

const distDir = path.resolve(process.cwd(), 'dist');
if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  fail('dist/index.html not found — run the Vite build first');
}

// Capgo requires index.html at the zip root and no hidden entries.
const zipPath = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), 'ota-')), `${version}.zip`);
execFileSync('zip', ['-r', '-q', '-X', zipPath, '.', '-x', '.*', '-x', '*/.*'], { cwd: distDir });

const zip = await fsp.readFile(zipPath);
const checksum = createHash('sha256').update(zip).digest('hex');

const url =
  `${backend}/ota/publish?channel=${channel}&version=${encodeURIComponent(version)}` +
  (minVersion ? `&minVersion=${encodeURIComponent(minVersion)}` : '') +
  (nativeFloor ? `&nativeFloor=${encodeURIComponent(nativeFloor)}` : '');
const res = await fetch(url, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/zip' },
  body: zip,
});

const text = await res.text();
if (!res.ok) fail(`Publish failed (${res.status}): ${text}`);

const published = JSON.parse(text);
if (published.checksum !== checksum) {
  fail(`Checksum mismatch — local ${checksum}, server ${published.checksum}`);
}

console.log(`✔ Published ${channel} bundle ${version} (${zip.length} bytes)`);
console.log(`  checksum ${checksum}`);
if (published.minVersion) console.log(`  minVersion ${published.minVersion} (older clients gated)`);
if (published.nativeFloor) {
  console.log(
    `  native floor ${published.nativeFloor} (older shells keep their newest compatible bundle)`,
  );
}
