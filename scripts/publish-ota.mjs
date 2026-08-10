#!/usr/bin/env node
/**
 * Publish the current dist/ as an OTA bundle to the self-hosted update endpoint.
 *
 *   node scripts/publish-ota.mjs --channel testflight [--version 1.0.1]
 *
 * Env:
 *   OTA_BACKEND_URL    backend base URL (defaults per channel, see below)
 *   OTA_PUBLISH_TOKEN  bearer token matching the backend's OTA_PUBLISH_TOKEN
 *
 * The bundle version must be greater than the native app version (iOS
 * MARKETING_VERSION / Android versionName) or devices will treat it as stale.
 */
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
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

const channel = arg('channel');
if (!Object.keys(DEFAULT_BACKENDS).includes(channel)) {
  fail(`--channel must be one of: ${Object.keys(DEFAULT_BACKENDS).join(', ')}`);
}

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const version = arg('version') || pkg.version;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version || '')) {
  fail(`Invalid bundle version "${version}" — expected semver like 1.0.1`);
}

const token = process.env.OTA_PUBLISH_TOKEN;
if (!token) fail('OTA_PUBLISH_TOKEN is not set');

const backend = (process.env.OTA_BACKEND_URL || DEFAULT_BACKENDS[channel]).replace(/\/+$/, '');

const distDir = path.resolve(process.cwd(), 'dist');
if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  fail('dist/index.html not found — run the Vite build first');
}

// Capgo requires index.html at the zip root and no hidden entries.
const zipPath = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), 'ota-')), `${version}.zip`);
execFileSync('zip', ['-r', '-q', '-X', zipPath, '.', '-x', '.*', '-x', '*/.*'], { cwd: distDir });

const zip = await fsp.readFile(zipPath);
const checksum = createHash('sha256').update(zip).digest('hex');

const url = `${backend}/ota/publish?channel=${channel}&version=${encodeURIComponent(version)}`;
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
