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
import { CapacitorUpdater, type BundleInfo } from '@capgo/capacitor-updater';
import { isOlder } from '@timehuddle/ota-version';

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

/** The bundle actually running — falls back to the native build after a store install. */
async function runningVersion(): Promise<string> {
  const { bundle, native } = await CapacitorUpdater.current();
  return bundle?.version && bundle.version !== 'builtin' ? bundle.version : native;
}

/**
 * Resolves to a ForcedUpdate when the running bundle is below the channel's
 * minVersion, or null when the app is safe to use.
 */
export async function checkForcedUpdate(): Promise<ForcedUpdate | null> {
  if (!Capacitor.isNativePlatform() || !CHANNEL) return null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    const res = await fetch(`${METEOR_BASE_URL}/ota/latest?channel=${CHANNEL}`, {
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));
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
 * Finds a copy of `version` the plugin has already pulled down.
 *
 * `autoUpdate: 'atBackground'` means the plugin fetches the same bundle on its
 * own schedule, so by the time the gate runs the download may already be done
 * or in flight. Re-downloading it would at best waste the user's bandwidth on
 * the slow connection this gate exists to serve, and at worst collide with the
 * plugin's own in-flight copy — leaving the user stuck at "Update failed" with
 * a retry that keeps losing the same race.
 *
 * Best-effort only: a failure here just means we download normally.
 */
async function findDownloadedBundle(version: string): Promise<BundleInfo | null> {
  try {
    const { bundles } = await CapacitorUpdater.list();
    return (
      bundles.find(
        (bundle) =>
          bundle.version === version &&
          (bundle.status === 'success' || bundle.status === 'pending'),
      ) ?? null
    );
  } catch {
    return null;
  }
}

/**
 * Downloads and activates the update.
 *
 * `set()` reloads the WebView, so on success this normally never returns — the
 * caller must not treat resolution as "done and still running".
 */
export async function applyForcedUpdate(
  update: ForcedUpdate,
  onProgress?: (percent: number) => void,
): Promise<void> {
  const listener = onProgress
    ? await CapacitorUpdater.addListener('download', ({ percent }) => onProgress(percent))
    : null;
  try {
    const bundle =
      (await findDownloadedBundle(update.version)) ??
      (await CapacitorUpdater.download({
        url: update.url,
        version: update.version,
        checksum: update.checksum,
      }));
    await CapacitorUpdater.set({ id: bundle.id });
  } finally {
    await listener?.remove();
  }
}
