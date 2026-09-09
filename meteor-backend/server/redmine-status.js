/**
 * Pure shaping of a `redmine_links` row into the client-safe status object.
 *
 * Kept free of Meteor imports so it can be unit-tested directly (see
 * tests/redmine-status.test.ts). Two invariants live here:
 *   1. The encrypted `apiKey` is NEVER included in the result.
 *   2. `baseUrl` is derived from server config at read time (passed in by the
 *      caller) rather than read from the row — the configured instance is the
 *      single source of truth, so it can't go stale per-user.
 */

/**
 * @param {object|null} link  the stored redmine_links document (or null)
 * @param {string} [baseUrl]  the server-configured Redmine base URL
 */
export function toStatus(link, baseUrl) {
  if (!link) return { connected: false };
  const fullName = `${link.firstname ?? ''} ${link.lastname ?? ''}`.trim();
  return {
    connected: true,
    redmineUserId: link.redmineUserId,
    redmineLogin: link.redmineLogin,
    redmineName: fullName || link.redmineLogin,
    baseUrl: baseUrl ?? null,
    linkedAt: link.linkedAt instanceof Date ? link.linkedAt.toISOString() : (link.linkedAt ?? null),
  };
}
