/**
 * OTA live updates for the Capacitor apps (@capgo/capacitor-updater, self-hosted).
 *
 *   POST /ota/check?channel=<channel>          → update descriptor for a device
 *   GET  /ota/latest?channel=<channel>         → current bundle metadata (latest.json)
 *   GET  /ota/bundles/<channel>/<version>.zip  → bundle download
 *   POST /ota/publish?channel=&version=        → publish a bundle (Bearer token)
 *   POST /ota/min-version?channel=&version=    → gate stale clients (Bearer token)
 *
 * minVersion is the kill switch: clients running older than it must update
 * before they can be used, rather than picking the bundle up whenever they
 * happen to background the app.
 *
 * Layout on disk (OTA_DIR, default data/ota):
 *   <channel>/latest.json   { version, file, checksum, size, publishedAt, minVersion }
 *   <channel>/<version>.zip
 *
 * Protocol: https://capgo.app/docs/plugin/self-hosted/auto-update/
 */
import { WebApp } from 'meteor/webapp';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';

const OTA_DIR = process.env.OTA_DIR || path.resolve(process.cwd(), 'data/ota');
const OTA_CHANNELS = ['testflight', 'production'];
const PUBLISH_TOKEN = process.env.OTA_PUBLISH_TOKEN || '';
const MAX_BUNDLE_BYTES = 150 * 1024 * 1024;
const MAX_DEVICE_INFO_BYTES = 64 * 1024;

// Absolute base for download URLs — the plugin needs a fully-qualified URL.
const PUBLIC_URL = (process.env.OTA_PUBLIC_URL || process.env.ROOT_URL || '').replace(/\/+$/, '');

const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

// The plugin treats this shape as "device is current" rather than an error.
function upToDate(res) {
  sendJson(res, 200, {
    kind: 'up_to_date',
    error: 'no_new_version_available',
    message: 'No new version available',
  });
}

function queryOf(req) {
  return new URL(req.url, 'http://placeholder').searchParams;
}

function channelOf(req) {
  const channel = queryOf(req).get('channel');
  return OTA_CHANNELS.includes(channel) ? channel : null;
}

/** Coerces "1.0" / "v1.2.3-beta.1" to a [major, minor, patch] tuple. */
function versionTuple(value) {
  const core = String(value || '')
    .trim()
    .replace(/^v/, '')
    .split(/[-+]/)[0]
    .split('.');
  return [0, 1, 2].map((i) => Number.parseInt(core[i], 10) || 0);
}

function isNewer(candidate, current) {
  const a = versionTuple(candidate);
  const b = versionTuple(current);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readLatest(channel) {
  try {
    const raw = await fsp.readFile(path.join(OTA_DIR, channel, 'latest.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Rename-based write so a concurrent check never reads a half-written file. */
async function writeLatest(channel, manifest) {
  const dir = path.join(OTA_DIR, channel);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `latest.json.${randomBytes(8).toString('hex')}.tmp`);
  await fsp.writeFile(tmp, JSON.stringify(manifest, null, 2));
  await fsp.rename(tmp, path.join(dir, 'latest.json'));
}

function isAuthorized(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return false;
  const provided = Buffer.from(header.slice(7));
  const expected = Buffer.from(PUBLISH_TOKEN);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

// ── Update check ──────────────────────────────────────────────────────────────

WebApp.connectHandlers.use('/ota/check', async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed', message: 'POST required' });
    return;
  }

  const channel = channelOf(req);
  if (!channel) {
    sendJson(res, 400, { error: 'unknown_channel', message: 'Unknown update channel' });
    return;
  }

  let device = {};
  try {
    const body = await readBody(req, MAX_DEVICE_INFO_BYTES);
    device = JSON.parse(body.toString('utf8') || '{}');
  } catch {
    // Device info is advisory — a malformed body still gets an honest answer.
  }

  const latest = await readLatest(channel);
  if (!latest?.version || !latest?.file || !PUBLIC_URL) {
    upToDate(res);
    return;
  }

  // version_name is the running OTA bundle, or "builtin" straight after a
  // store install — in which case the native build version is the baseline.
  const installed =
    device.version_name && device.version_name !== 'builtin'
      ? device.version_name
      : device.version_build;

  if (!isNewer(latest.version, installed)) {
    upToDate(res);
    return;
  }

  sendJson(res, 200, {
    version: latest.version,
    url: `${PUBLIC_URL}/ota/bundles/${channel}/${encodeURIComponent(latest.file)}`,
    checksum: latest.checksum,
    ...(latest.minVersion ? { minVersion: latest.minVersion } : {}),
  });
});

// ── Latest bundle metadata ────────────────────────────────────────────────────

WebApp.connectHandlers.use('/ota/latest', async (req, res) => {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'method_not_allowed', message: 'GET required' });
    return;
  }

  const channel = channelOf(req);
  if (!channel) {
    sendJson(res, 400, { error: 'unknown_channel', message: 'Unknown update channel' });
    return;
  }

  const latest = await readLatest(channel);
  if (!latest) {
    sendJson(res, 404, { error: 'no_bundle', message: 'No bundle published for this channel' });
    return;
  }

  const url = PUBLIC_URL
    ? `${PUBLIC_URL}/ota/bundles/${channel}/${encodeURIComponent(latest.file)}`
    : undefined;
  sendJson(res, 200, { ...latest, url });
});

// ── Bundle download ───────────────────────────────────────────────────────────

WebApp.connectHandlers.use('/ota/bundles', (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    next();
    return;
  }

  // decodeURIComponent throws on malformed percent-encoding — treat as not found.
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    res.writeHead(404);
    res.end();
    return;
  }

  const [, channel, file] = decodedPath.split('/');
  if (!OTA_CHANNELS.includes(channel) || !/^[\w.-]+\.zip$/.test(file || '')) {
    res.writeHead(404);
    res.end();
    return;
  }

  const filePath = path.join(OTA_DIR, channel, path.basename(file));
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    res.writeHead(404);
    res.end();
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Length': stat.size,
    'Cache-Control': 'public, max-age=31536000, immutable',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(filePath).pipe(res);
});

// ── Publish ───────────────────────────────────────────────────────────────────

WebApp.connectHandlers.use('/ota/publish', async (req, res) => {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed', message: 'POST required' });
    return;
  }
  if (!PUBLISH_TOKEN) {
    sendJson(res, 503, { error: 'publishing_disabled', message: 'OTA_PUBLISH_TOKEN is not set' });
    return;
  }
  if (!isAuthorized(req)) {
    sendJson(res, 401, { error: 'unauthorized', message: 'Invalid publish token' });
    return;
  }

  const channel = channelOf(req);
  if (!channel) {
    sendJson(res, 400, { error: 'unknown_channel', message: 'Unknown update channel' });
    return;
  }

  const version = queryOf(req).get('version') || '';
  if (!VERSION_RE.test(version)) {
    sendJson(res, 400, { error: 'invalid_version', message: 'version must be semver (1.2.3)' });
    return;
  }

  let zip;
  try {
    zip = await readBody(req, MAX_BUNDLE_BYTES);
  } catch {
    sendJson(res, 413, { error: 'payload_too_large', message: 'Bundle exceeds size limit' });
    return;
  }
  if (zip.length < 4 || zip[0] !== 0x50 || zip[1] !== 0x4b) {
    sendJson(res, 400, { error: 'invalid_bundle', message: 'Body is not a zip archive' });
    return;
  }

  // Carried over unless this publish overrides it, so a routine release never
  // silently un-gates clients an earlier min-version bump was holding back.
  const requestedMin = queryOf(req).get('minVersion');
  if (requestedMin !== null && !VERSION_RE.test(requestedMin)) {
    sendJson(res, 400, { error: 'invalid_min_version', message: 'minVersion must be semver (1.2.3)' });
    return;
  }
  if (requestedMin !== null && isNewer(requestedMin, version)) {
    sendJson(res, 400, {
      error: 'invalid_min_version',
      message: 'minVersion cannot exceed the published version',
    });
    return;
  }
  const minVersion = requestedMin ?? (await readLatest(channel))?.minVersion;

  const checksum = createHash('sha256').update(zip).digest('hex');
  const file = `${version}.zip`;
  const dir = path.join(OTA_DIR, channel);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, file), zip);

  const manifest = {
    version,
    file,
    checksum,
    size: zip.length,
    publishedAt: new Date().toISOString(),
    ...(minVersion ? { minVersion } : {}),
  };
  await writeLatest(channel, manifest);

  console.log(`[ota] published ${channel} ${version} (${zip.length} bytes)`);
  sendJson(res, 200, manifest);
});

// ── Minimum version gate ──────────────────────────────────────────────────────

WebApp.connectHandlers.use('/ota/min-version', async (req, res) => {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed', message: 'POST required' });
    return;
  }
  if (!PUBLISH_TOKEN) {
    sendJson(res, 503, { error: 'publishing_disabled', message: 'OTA_PUBLISH_TOKEN is not set' });
    return;
  }
  if (!isAuthorized(req)) {
    sendJson(res, 401, { error: 'unauthorized', message: 'Invalid publish token' });
    return;
  }

  const channel = channelOf(req);
  if (!channel) {
    sendJson(res, 400, { error: 'unknown_channel', message: 'Unknown update channel' });
    return;
  }

  // Empty version clears the gate.
  const version = queryOf(req).get('version') || '';
  if (version && !VERSION_RE.test(version)) {
    sendJson(res, 400, { error: 'invalid_version', message: 'version must be semver (1.2.3)' });
    return;
  }

  const latest = await readLatest(channel);
  if (!latest?.version) {
    sendJson(res, 404, { error: 'no_bundle', message: 'No bundle published for this channel' });
    return;
  }
  // Gating above the newest bundle would lock every client out with no way up.
  if (version && isNewer(version, latest.version)) {
    sendJson(res, 400, {
      error: 'invalid_min_version',
      message: `minVersion cannot exceed the latest published version (${latest.version})`,
    });
    return;
  }

  const manifest = { ...latest };
  if (version) manifest.minVersion = version;
  else delete manifest.minVersion;
  await writeLatest(channel, manifest);

  console.log(`[ota] ${channel} minVersion ${version || 'cleared'}`);
  sendJson(res, 200, manifest);
});
