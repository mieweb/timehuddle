/**
 * Shared plumbing for the OTA command-line scripts (publish-ota, ota-min-version).
 *
 * Both scripts take the same --channel, resolve the same per-channel backend,
 * and read the same OTA_PUBLISH_TOKEN out of the same env files, so that lives
 * here rather than being copied between them.
 */
import fs from 'fs';
import path from 'path';

export const DEFAULT_BACKENDS = {
  testflight: 'https://timecore-dev.os.mieweb.org',
  production: 'https://timecore-prod.os.mieweb.org',
};

/** Reads `--name <value>` out of argv. */
export function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

export function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

/** Load KEY=VALUE pairs from .env.<channel> and .env.local (no-op if absent). */
export function loadEnvFile(channel) {
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

/** Validates --channel, loads its env file, and returns the resolved backend. */
export function resolveChannel() {
  const channel = arg('channel');
  if (!Object.keys(DEFAULT_BACKENDS).includes(channel)) {
    fail(`--channel must be one of: ${Object.keys(DEFAULT_BACKENDS).join(', ')}`);
  }
  loadEnvFile(channel);

  const token = process.env.OTA_PUBLISH_TOKEN;
  if (!token) fail(`OTA_PUBLISH_TOKEN is not set — add it to .env.${channel} or pass it inline`);

  const backend = (process.env.OTA_BACKEND_URL || DEFAULT_BACKENDS[channel]).replace(/\/+$/, '');
  return { channel, token, backend };
}
