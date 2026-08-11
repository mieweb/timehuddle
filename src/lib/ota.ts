/**
 * Forced-update gate for OTA bundles.
 *
 * The backend publishes a `minVersion` alongside each channel's latest bundle.
 * A client running older than that is considered unsafe to use — this module
 * detects that case so the UI can hold the user at a blocking screen and pull
 * the fix down, instead of waiting for the next silent background swap.
 *
 * Fail-open by design: if the check itself can't reach the backend we let the
 * user through, because a device that can't talk to the server can't download
 * the update either and blocking it would help nobody.
 */
import { Capacitor } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';

import { METEOR_BASE_URL } from './api';

const CHANNELS = ['testflight', 'production'] as const;
type Channel = (typeof CHANNELS)[number];

// Vite's build mode maps 1:1 onto the OTA channel names, so `npm run dev`
// (mode "development") naturally has no gate.
const CHANNEL = (CHANNELS as readonly string[]).includes(import.meta.env.MODE)
  ? (import.meta.env.MODE as Channel)
  : null;

const CHECK_TIMEOUT_MS = 8000;

export interface ForcedUpdate {
  /** Version the device must reach before the app is usable. */
  minVersion: string;
  /** Latest published version — what actually gets downloaded. */
  version: string;
  url: string;
  checksum?: string;
  running: string;
}

/** Coerces "1.0" / "v1.2.3-beta.1" to a [major, minor, patch] tuple. */
function versionTuple(value: string): [number, number, number] {
  const core = String(value || '')
    .trim()
    .replace(/^v/, '')
    .split(/[-+]/)[0]
    .split('.');
  return [0, 1, 2].map((i) => Number.parseInt(core[i], 10) || 0) as [number, number, number];
}

function isOlder(candidate: string, than: string): boolean {
  const a = versionTuple(candidate);
  const b = versionTuple(than);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

/** The bundle actually running — falls back to the native build after a store install. */
async function runningVersion(): Promise<string> {
  const { bundle, native } = await CapacitorUpdater.current();
  return bundle?.version && bundle.version !== 'builtin' ? bundle.version : native;
}

/**
 * Resolves to a ForcedUpdate when ANY newer bundle is available (not just
 * when below minVersion). Used by OtaUpdateGate to block every launch until
 * the user is on the latest bundle.
 *
 * Fails open — if the backend can't be reached the user gets through, since
 * a device that can't talk to the server can't download the update either.
 */
export async function checkPendingUpdate(): Promise<ForcedUpdate | null> {
  if (!Capacitor.isNativePlatform() || !CHANNEL) return null;

  try {
    const res = await fetch(`${METEOR_BASE_URL}/ota/latest?channel=${CHANNEL}`, {
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const latest = (await res.json()) as Partial<ForcedUpdate> & { minVersion?: string };
    if (!latest.version || !latest.url) return null;

    const running = await runningVersion();
    if (!isOlder(running, latest.version)) return null;

    return {
      minVersion: latest.minVersion ?? latest.version,
      version: latest.version,
      url: latest.url,
      checksum: latest.checksum,
      running,
    };
  } catch {
    return null;
  }
}

/**
 * Resolves to a ForcedUpdate when the running bundle is below the channel's
 * minVersion, or null when the app is safe to use.
 */
export async function checkForcedUpdate(): Promise<ForcedUpdate | null> {
  if (!Capacitor.isNativePlatform() || !CHANNEL) return null;

  try {
    const res = await fetch(`${METEOR_BASE_URL}/ota/latest?channel=${CHANNEL}`, {
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const latest = (await res.json()) as Partial<ForcedUpdate> & { minVersion?: string };
    if (!latest.minVersion || !latest.version || !latest.url) return null;

    const running = await runningVersion();
    if (!isOlder(running, latest.minVersion)) return null;

    return {
      minVersion: latest.minVersion,
      version: latest.version,
      url: latest.url,
      checksum: latest.checksum,
      running,
    };
  } catch {
    return null;
  }
}

/**
 * Downloads and activates the update. `set()` reloads the WebView, so on
 * success this never returns.
 */
export async function applyForcedUpdate(
  update: ForcedUpdate,
  onProgress?: (percent: number) => void,
): Promise<void> {
  const listener = onProgress
    ? await CapacitorUpdater.addListener('download', ({ percent }) => onProgress(percent))
    : null;
  try {
    const bundle = await CapacitorUpdater.download({
      url: update.url,
      version: update.version,
      checksum: update.checksum,
    });
    await CapacitorUpdater.set({ id: bundle.id });
  } finally {
    await listener?.remove();
  }
}
