/**
 * Native floors for OTA bundles: which bundle a device's native shell can run.
 *
 * A bundle published with a native floor needs a native build at or above it
 * (for example web code that calls a plugin only newer shells carry). The floor
 * is bumped only for breaking web ↔ native changes; plugin-version differences
 * need none, because the web feature-detects.
 *
 * Layout on disk, next to latest.json (see ota.js):
 *   <channel>/latest.json             the newest bundle overall, with its nativeFloor
 *   <channel>/floors/<floor>.json     the newest bundle published at that floor
 *
 * A device is offered the newest bundle among latest.json and the floor
 * manifests whose floor is at or below its native build (`version_build`), so
 * an older shell gets the newest bundle it can run instead of `up_to_date`.
 * A manifest without a nativeFloor runs on any shell, so until a floor is
 * published every answer is exactly what it was before floors existed.
 *
 * Pure logic: no Meteor imports, no file system (ota.js does the I/O).
 */
import { compareVersions, isNewer } from '@timehuddle/ota-version';

/** A native floor is a native app version: plain semver core, no prerelease. */
export const FLOOR_RE = /^\d+\.\d+\.\d+$/;

/** Floor recorded for bundles published before any floor existed. */
export const NO_FLOOR = '0.0.0';

export function isValidFloor(value) {
  return FLOOR_RE.test(String(value ?? ''));
}

/** `floors/<floor>.json` → floor, or null for anything else in the directory. */
export function floorFromFileName(name) {
  const match = /^(\d+\.\d+\.\d+)\.json$/.exec(String(name ?? ''));
  return match ? match[1] : null;
}

export function floorFileName(floor) {
  return `${floor}.json`;
}

function isServable(manifest) {
  return Boolean(manifest?.version && manifest?.file);
}

/**
 * The newest bundle a shell with native build `nativeBuild` can run, or null.
 *
 * `floors` are the floor manifests, each carrying its `nativeFloor`. latest.json
 * goes first so it wins a tie with its own floor copy: it is the one that
 * carries the current minVersion. A device that reports no native build only
 * gets bundles without a floor.
 */
export function compatibleManifest(latest, floors, nativeBuild) {
  let best = null;
  for (const manifest of [latest, ...(floors ?? [])]) {
    if (!isServable(manifest)) continue;
    if (isNewer(manifest.nativeFloor || NO_FLOOR, nativeBuild || NO_FLOOR)) continue;
    if (!best || isNewer(manifest.version, best.version)) best = manifest;
  }
  return best;
}

/**
 * The /ota/check answer: the update descriptor, or null for "up to date".
 *
 * `device` is the capgo plugin's device info. `bundleUrl(file)` builds the
 * absolute download URL. Key order and fields match the pre-floor answer.
 */
export function checkAnswer({ latest, floors, device, bundleUrl }) {
  const manifest = compatibleManifest(latest, floors, device?.version_build);
  if (!manifest) return null;

  // version_name is the running OTA bundle, or "builtin" straight after a
  // store install — in which case the native build version is the baseline.
  const installed =
    device?.version_name && device.version_name !== 'builtin'
      ? device.version_name
      : device?.version_build;

  if (!isNewer(manifest.version, installed)) return null;

  // A gate above the bundle on offer could never be cleared by downloading it.
  const minVersion =
    manifest.minVersion && !isNewer(manifest.minVersion, manifest.version)
      ? manifest.minVersion
      : undefined;

  return {
    version: manifest.version,
    url: bundleUrl(manifest.file),
    checksum: manifest.checksum,
    ...(minVersion ? { minVersion } : {}),
  };
}

/**
 * What a publish writes besides the zip.
 *
 * `previous` is the current latest.json (or null), `manifest` the new bundle's
 * manifest, `requestedFloor` the publish's nativeFloor (undefined when not
 * given). The floor carries over from the previous bundle when not given, like
 * minVersion: every later bundle builds on the code that needed it.
 *
 * Returns `{ latest, floorWrites: [{ floor, manifest }] }`, or `{ error }`.
 * With no floor requested and none in force, floorWrites is empty and latest is
 * the manifest unchanged.
 */
export function publishPlan({ previous, manifest, requestedFloor }) {
  const floor = requestedFloor ?? previous?.nativeFloor;
  if (floor == null) return { latest: manifest, floorWrites: [] };
  // Checked for a carried-over floor too: it names a file under floors/.
  if (!isValidFloor(floor)) {
    return {
      error: 'invalid_native_floor',
      message: 'nativeFloor must be a native version (1.2.3)',
    };
  }

  // Devices treat a bundle at or below their native version as stale, so a
  // bundle below its own floor would never be taken by a shell that can run it.
  if (isNewer(floor, manifest.version)) {
    return {
      error: 'invalid_native_floor',
      message: 'nativeFloor cannot exceed the published version',
    };
  }

  const latest = { ...manifest, nativeFloor: floor };
  const floorWrites = [{ floor, manifest: latest }];

  // When the floor moves, keep the bundle being replaced reachable for shells
  // below the new floor: the first floored publish files the last floor-free
  // bundle under 0.0.0. Rewriting a floored predecessor's own file also carries
  // any minVersion set on latest.json since that bundle was published.
  const previousFloor = previous?.nativeFloor || NO_FLOOR;
  if (
    isServable(previous) &&
    isValidFloor(previousFloor) &&
    compareVersions(previousFloor, floor) !== 0
  ) {
    floorWrites.unshift({
      floor: previousFloor,
      manifest: { ...previous, nativeFloor: previousFloor },
    });
  }

  return { latest, floorWrites };
}
