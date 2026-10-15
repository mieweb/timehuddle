/**
 * Scheduled Huddle posts (#596), pure rules shared by the methods and the
 * publication. A scheduled post carries `deliverAt` and `deliveryMode`; its
 * Agenda job stamps `deliveredAt` and notifies.
 *
 * - `silent`: in the feed straight away, notifications wait for `deliverAt`.
 * - `hidden`: only its author sees it until it is delivered.
 */

export const DELIVERY_MODES = ['silent', 'hidden'];
export const MAX_SCHEDULE_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Read a client-supplied schedule. `{ schedule: null }` when none was given,
 * `{ error }` when it can't be used, else `{ schedule: { deliverAt, deliveryMode } }`.
 * The mode defaults to `silent`.
 */
export function parseSchedule({ deliverAt, deliveryMode } = {}, now = Date.now()) {
  if (deliverAt === undefined || deliverAt === null) {
    if (deliveryMode !== undefined && deliveryMode !== null) {
      return { error: 'deliveryMode needs a deliverAt' };
    }
    return { schedule: null };
  }
  if (typeof deliverAt !== 'string') return { error: 'deliverAt must be an ISO date string' };
  const ms = Date.parse(deliverAt);
  if (Number.isNaN(ms)) return { error: 'deliverAt must be an ISO date string' };
  if (ms <= now) return { error: 'deliverAt must be in the future' };
  if (ms > now + MAX_SCHEDULE_AHEAD_MS) return { error: 'deliverAt must be within a year' };
  const mode = deliveryMode ?? 'silent';
  if (!DELIVERY_MODES.includes(mode)) {
    return { error: `deliveryMode must be one of ${DELIVERY_MODES.join(', ')}` };
  }
  return { schedule: { deliverAt: new Date(ms), deliveryMode: mode } };
}

/** Whether a post is scheduled and its time hasn't been reached (or forced) yet. */
export function isAwaitingDelivery(post) {
  return Boolean(post.deliverAt) && !post.deliveredAt;
}

/** Whether `userId` must not see `post` yet: hidden, undelivered and not theirs. */
export function isHiddenFrom(post, userId) {
  return post.deliveryMode === 'hidden' && !post.deliveredAt && post.userId !== userId;
}

/** Mongo filter for the posts `userId` may see — the query form of `isHiddenFrom`. */
export function visibleTo(userId) {
  return {
    $or: [{ deliveryMode: { $ne: 'hidden' } }, { deliveredAt: { $ne: null } }, { userId }],
  };
}
