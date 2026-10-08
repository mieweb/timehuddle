/**
 * Where files the server writes (uploads, videos, OTA bundles) live.
 *
 * Meteor runs the server from `.meteor/local/build/programs/server`, and a
 * rebuild replaces that tree — so a default resolved against `process.cwd()`
 * puts user files inside the build output, where the next deploy deletes them
 * (that is how Pulse videos were lost before). Defaults resolve against the
 * app root (meteor-backend/) instead; the env var still wins when set.
 */
import path from 'path';

const BUILD_MARKER = `${path.sep}.meteor${path.sep}`;

/** meteor-backend/, whether running from source, a test build, or the dev build. */
export const APP_ROOT = process.cwd().split(BUILD_MARKER)[0];

/** `envValue` when set, else `relative` under the app root. */
export function persistentDir(envValue, relative) {
  return envValue || path.resolve(APP_ROOT, relative);
}

/** True when `dir` is inside Meteor's build output, which a rebuild wipes. */
export function isInsideMeteorBuild(dir) {
  return path.resolve(dir).includes(BUILD_MARKER);
}
