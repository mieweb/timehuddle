/**
 * Pure shaping of a `redmine_links` row into the client-safe status object.
 *
 * Two invariants live here:
 *   1. The encrypted `apiKey` is NEVER included in the result.
 *   2. `baseUrl` is resolved by the caller (`linkedRedmineBaseUrl`) rather than
 *      read from the row here — whether a stored URL counts depends on server
 *      config (`REDMINE_ALLOW_CUSTOM_URL`), which this pure module doesn't read.
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
