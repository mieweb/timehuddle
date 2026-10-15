/**
 * Scheduled Huddle posts (#596), pure rules shared by the methods and the
 * publication. A scheduled post carries `deliverAt`; until its Agenda job
 * stamps `deliveredAt` it is its author's alone and nobody is notified.
 */

export const MAX_SCHEDULE_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Read a client-supplied schedule. `{ schedule: null }` when none was given,
 * `{ error }` when it can't be used, else `{ schedule: { deliverAt } }`.
 */
export function parseSchedule({ deliverAt } = {}, now = Date.now()) {
  if (deliverAt === undefined || deliverAt === null) return { schedule: null };
  if (typeof deliverAt !== 'string') return { error: 'deliverAt must be an ISO date string' };
  const ms = Date.parse(deliverAt);
  if (Number.isNaN(ms)) return { error: 'deliverAt must be an ISO date string' };
  if (ms <= now) return { error: 'deliverAt must be in the future' };
  if (ms > now + MAX_SCHEDULE_AHEAD_MS) return { error: 'deliverAt must be within a year' };
  return { schedule: { deliverAt: new Date(ms) } };
}

/** Whether a post is scheduled and its time hasn't been reached (or forced) yet. */
export function isAwaitingDelivery(post) {
  return Boolean(post.deliverAt) && !post.deliveredAt;
}

/** Whether `userId` must not see `post` yet: undelivered and not theirs. */
export function isHiddenFrom(post, userId) {
  return isAwaitingDelivery(post) && post.userId !== userId;
}

/** Mongo filter for the posts `userId` may see — the query form of `isHiddenFrom`. */
export function visibleTo(userId) {
  return { $or: [{ deliverAt: null }, { deliveredAt: { $ne: null } }, { userId }] };
}
