/**
 * The date window every Huddle feed is read through (#635): the publication,
 * the REST fetch and the Personal view all take the same `since`, so loading
 * older posts means moving one boundary rather than adding a second path.
 */

export const DEFAULT_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Start of the window as a Date, from a client-supplied ISO string. Absent
 * means the default window; an unparseable value is null so the caller can
 * reject it.
 */
export function resolveSince(since, now = Date.now()) {
  if (since === undefined || since === null) return new Date(now - DEFAULT_WINDOW_DAYS * DAY_MS);
  if (typeof since !== 'string') return null;
  const ms = Date.parse(since);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/** Whether a post created at `createdAt` falls before the window starts. */
export function isBeforeWindow(createdAt, sinceDate) {
  return new Date(createdAt).getTime() < sinceDate.getTime();
}
