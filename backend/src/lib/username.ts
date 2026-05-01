/**
 * Username utilities for the backend.
 *
 * Covers:
 * - Constants (length limits)
 * - Normalization (canonical form)
 * - Validation (length, character rules)
 * - Reserved/blocked name policy
 * - Deterministic collision resolution
 * - Namespace compatibility (ID-based → username migration)
 */

// ─── Constants ────────────────────────────────────────────────────────────────

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;

// ─── Reserved names ───────────────────────────────────────────────────────────

/**
 * Names that cannot be claimed as usernames.
 *
 * Categories:
 * - Route/system roots that must not be captured by user slugs
 * - Trust-sensitive terms (staff, official roles, platform identity)
 * - Common abuse / confusion terms
 *
 * Ownership: updated by maintainers via PR. Appeals go through
 * the standard GitHub issue process on this repository.
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  // Route roots
  "admin",
  "api",
  "app",
  "auth",
  "dashboard",
  "help",
  "login",
  "logout",
  "me",
  "pricing",
  "privacy",
  "settings",
  "signup",
  "status",
  "support",
  "terms",
  "www",
  // Trust-sensitive
  "administrator",
  "mod",
  "moderator",
  "official",
  "root",
  "staff",
  "system",
  "timehuddle",
  // Confusion / abuse
  "anonymous",
  "ghost",
  "null",
  "undefined",
  "unknown",
]);

// ─── Normalization ────────────────────────────────────────────────────────────

/**
 * Normalizes an arbitrary string into a candidate username.
 *
 * Rules applied in order:
 * 1. Lowercase
 * 2. Trim leading/trailing whitespace
 * 3. Replace spaces and underscores with hyphens
 * 4. Strip characters that are not alphanumeric or hyphens
 * 5. Collapse consecutive hyphens to one
 * 6. Remove leading/trailing hyphens
 * 7. Truncate to USERNAME_MAX
 *
 * Note: the result may still fail validation (e.g. too short or reserved).
 */
export function normalizeUsername(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, USERNAME_MAX);
}

// ─── Validation ───────────────────────────────────────────────────────────────

export interface UsernameValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates a *normalized* username string.
 *
 * Expects input already passed through `normalizeUsername`.
 * Returns `{ valid: true }` on success or `{ valid: false, error }` on failure.
 */
export function validateUsername(username: string): UsernameValidationResult {
  if (username.length < USERNAME_MIN) {
    return { valid: false, error: `Username must be at least ${USERNAME_MIN} characters` };
  }
  if (username.length > USERNAME_MAX) {
    return { valid: false, error: `Username must be at most ${USERNAME_MAX} characters` };
  }
  if (!/^[a-z0-9]/.test(username)) {
    return { valid: false, error: "Username must start with a letter or number" };
  }
  if (!/[a-z0-9]$/.test(username)) {
    return { valid: false, error: "Username must end with a letter or number" };
  }
  if (!/^[a-z0-9-]+$/.test(username)) {
    return {
      valid: false,
      error: "Username may only contain lowercase letters, numbers, and hyphens",
    };
  }
  if (isReserved(username)) {
    return { valid: false, error: "This username is reserved and cannot be claimed" };
  }
  return { valid: true };
}

// ─── Reserved-name check ──────────────────────────────────────────────────────

/**
 * Returns true if the normalized username is in the reserved list.
 *
 * Always normalizes before checking so callers don't need to pre-normalize.
 */
export function isReserved(username: string): boolean {
  return RESERVED_USERNAMES.has(username.toLowerCase().trim());
}

// ─── Collision resolution ─────────────────────────────────────────────────────

/**
 * Deterministically resolves a username collision by appending a numeric suffix.
 *
 * Finds the lowest integer ≥ 2 such that `base + suffix` is not in `taken`.
 * Truncates the base if needed so the result stays within USERNAME_MAX.
 *
 * @param base   The desired (normalized) username.
 * @param taken  Set of usernames already in use (normalized).
 * @returns      A username that is not in `taken`.
 */
export function resolveCollision(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;

  for (let n = 2; n < 10_000; n++) {
    const suffix = String(n);
    const maxBase = USERNAME_MAX - suffix.length;
    const candidate = base.slice(0, maxBase) + suffix;
    if (!taken.has(candidate)) return candidate;
  }

  // Unreachable in practice — 10 000 retries exhausted.
  throw new Error(`Could not resolve collision for username "${base}" after 10 000 attempts`);
}

// ─── Namespace compatibility ──────────────────────────────────────────────────

/**
 * Returns the public URL slug for a user.
 *
 * During the migration period, profiles may be reached by either a claimed
 * username or the raw MongoDB ObjectId. This helper centralises the decision:
 * - If the user has a claimed username, that is returned.
 * - Otherwise the ID is returned as a fallback, preserving existing links.
 *
 * @param username  The user's claimed username (may be undefined/empty).
 * @param id        The user's MongoDB ObjectId hex string.
 */
export function usernameOrId(username: string | undefined | null, id: string): string {
  return username?.trim() || id;
}
