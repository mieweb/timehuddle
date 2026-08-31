/**
 * OTA bundle version comparison — the single source of truth for both sides
 * of the minVersion gate.
 *
 * The backend decides which clients are too old and the client decides whether
 * it is one of them. If those two answers ever disagree, a device either sits
 * behind a gate it can never clear or slips past one meant to catch it — so
 * the comparison lives here once rather than being reimplemented per side.
 *
 * Shipped as plain JS with hand-written types because the Meteor backend
 * consumes it directly and Meteor does not compile TypeScript inside
 * node_modules. See packages/README.md.
 */

/** Bundle versions are semver core, optionally with a prerelease tag. */
export const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** True when `value` is a publishable bundle version. */
export function isValidVersion(value) {
  return VERSION_RE.test(String(value ?? ''));
}

/**
 * Coerces "1.0" / "v1.2.3-beta.1" to a [major, minor, patch] tuple.
 *
 * Prerelease tags are deliberately dropped: both sides compare on the semver
 * core only, so 1.0.5-beta.1 and 1.0.5 are the same bundle for gating.
 */
export function versionTuple(value) {
  const core = String(value || '')
    .trim()
    .replace(/^v/, '')
    .split(/[-+]/)[0]
    .split('.');
  return [0, 1, 2].map((i) => Number.parseInt(core[i], 10) || 0);
}

/** -1 when a < b, 0 when equal, 1 when a > b. */
export function compareVersions(a, b) {
  const left = versionTuple(a);
  const right = versionTuple(b);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  return 0;
}

/** True when `candidate` is strictly older than `than`. */
export function isOlder(candidate, than) {
  return compareVersions(candidate, than) < 0;
}

/** True when `candidate` is strictly newer than `current`. */
export function isNewer(candidate, current) {
  return compareVersions(candidate, current) > 0;
}
