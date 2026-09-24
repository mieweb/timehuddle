/**
 * Pure shaping of a `redmine_links` row into the client-safe status object.
 *
 * Kept free of Meteor imports so it can be unit-tested directly (see
 * tests/redmine-status.test.ts). Two invariants live here:
 *   1. The encrypted `apiKey` is NEVER included in the result.
 *   2. `baseUrl` is resolved by the caller (`linkedRedmineBaseUrl`) rather than
 *      read from the row here — whether a stored URL counts depends on server
 *      config (`REDMINE_ALLOW_CUSTOM_URL`), which this pure module doesn't read.
 */

/**
 * @param {object|null} link  the stored redmine_links document (or null)
 * @param {string} [baseUrl]  the Redmine instance this link talks to
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
    // Null until the user picks one; the activity fallback chain handles absence.
    defaultActivityId: link.defaultActivityId ?? null,
  };
}
