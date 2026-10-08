/**
 * Where files the server writes (uploads, videos, OTA bundles) live.
 *
 * Meteor runs the server from `.meteor/local/build/programs/server`, and a
 * rebuild replaces that tree — so a default resolved against `process.cwd()`
 * puts user files inside the build output, where the next deploy deletes them
 * (that is how Pulse videos were lost before). Defaults resolve against the
 * app root (meteor-backend/) instead; the env var still wins when set.
 *
 * A `meteor build` bundle run with `node main.js` (docker-entrypoint.sh) has
 * no app root to fall back to: its working directory *is* the bundle, which
 * the next image replaces. There the defaults stay in the bundle and count as
 * build output, so set UPLOADS_DIR / VIDEOS_DIR / OTA_DIR to keep files.
 */
import fs from 'fs';
import path from 'path';

const BUILD_MARKER = `${path.sep}.meteor${path.sep}`;

/** The bundle root when running from a `meteor build` bundle, else null. */
const BUNDLE_ROOT = fs.existsSync(path.join(process.cwd(), 'programs', 'server'))
  ? process.cwd()
  : null;

/** meteor-backend/ from source or a dev/test build; the bundle root in a bundle. */
export const APP_ROOT = process.cwd().split(BUILD_MARKER)[0];

/** `envValue` when set, else `relative` under the app root. */
export function persistentDir(envValue, relative) {
  return envValue || path.resolve(APP_ROOT, relative);
}

/** True when `dir` is inside Meteor's build output or a bundle, which a deploy replaces. */
export function isInsideMeteorBuild(dir) {
  const abs = path.resolve(dir);
  if (abs.includes(BUILD_MARKER)) return true;
  return BUNDLE_ROOT !== null && `${abs}${path.sep}`.startsWith(`${BUNDLE_ROOT}${path.sep}`);
}
