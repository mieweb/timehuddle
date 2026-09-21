/**
 * Process-local, per-user TTL caches for Redmine reads that change rarely
 * (enumerations, project lists, project members).
 *
 * In-process and lossy on purpose: a stale entry costs at most a stale dropdown
 * for one TTL, and a cold cache after a restart costs one cheap GET. Nothing
 * here is persisted — M6 keeps Redmine reads live.
 *
 * Every cache is keyed by TimeHuddle user id first, so re-linking with a key
 * for a different Redmine account (`bustUserCaches`) can never be served the
 * previous account's view. Kept free of Meteor imports so callers stay
 * unit-testable.
 */

/** Every cache created here, so a disconnect can bust them all at once. */
const registry = new Set();

/**
 * Create a cache whose entries expire `ttlMs` after being fetched.
 *
 * `get(userId, subKey, fetchFn)` returns the fresh cached value or awaits
 * `fetchFn()`. Only successful fetches are stored, so a transient failure is
 * retried on the next call.
 */
export function createUserTtlCache(ttlMs) {
  const entries = new Map();

  const cache = {
    async get(userId, subKey, fetchFn) {
      const key = `${userId}|${subKey}`;
      const hit = entries.get(key);
      if (hit && hit.expiresAt > Date.now()) return hit.value;

      const value = await fetchFn();
      entries.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    },
    bust(userId) {
      const prefix = `${userId}|`;
      for (const key of entries.keys()) {
        if (key.startsWith(prefix)) entries.delete(key);
      }
    },
  };

  registry.add(cache);
  return cache;
}

/** Drop everything cached for a user, across every cache. Called on disconnect. */
export function bustUserCaches(userId) {
  for (const cache of registry) cache.bust(userId);
}
