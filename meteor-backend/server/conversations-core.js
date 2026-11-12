/**
 * Huddle conversation topics (#866) — the rules, with no Meteor or database.
 *
 * A conversation is a stable record a post points at (`huddlePosts.conversationId`):
 *   - `workday`: opened when a team starts its huddle, closed when the next one
 *     starts. Open to the whole team. Its name is its `dateKey`.
 *   - `group`:   a named team conversation with a fixed member list.
 *   - `direct`:  two people. Each sees the other's name.
 * Anyone can also give a conversation a personal name that only they see.
 */

/** A plain calendar date, e.g. "2026-11-12" — the same shape as a post's `postDate`. */
export const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Longest shared or personal name, in characters. */
export const LABEL_MAX = 80;

/** Whether `userId` is on `team`, as a member or an admin. */
export function isTeamMember(team, userId) {
  if (!team || !userId) return false;
  return (team.members ?? []).includes(userId) || (team.admins ?? []).includes(userId);
}

/**
 * The key that makes a pair's direct conversation unique: both user ids,
 * sorted, so Cindy→Bob and Bob→Cindy land on the same key.
 */
export function directKey(userA, userB) {
  if (!userA || !userB || userA === userB) {
    throw new Error('A direct conversation needs two different people');
  }
  return [String(userA), String(userB)].sort().join(':');
}

/** Whether new posts may go into `conversation`. Only a workday ever closes. */
export function isOpen(conversation) {
  if (!conversation) return false;
  return conversation.kind !== 'workday' || !conversation.closedAt;
}

/**
 * Whether `userId` may see `conversation`: they must be on its team, and for a
 * group or direct conversation also one of its members. A personal name never
 * changes this.
 */
export function canSee(conversation, userId, team) {
  if (!conversation || !isTeamMember(team, userId)) return false;
  if (String(conversation.teamId) !== String(team._id)) return false;
  if (conversation.kind === 'workday') return true;
  return (conversation.memberIds ?? []).includes(userId);
}

/**
 * A name as typed, trimmed and checked. `{ label }` when usable; `{ label: null }`
 * for an empty name (which clears a personal name); `{ error }` otherwise.
 */
export function cleanLabel(label) {
  if (label === null || label === undefined) return { label: null };
  if (typeof label !== 'string') return { error: 'A name must be text' };
  const trimmed = label.trim();
  if (!trimmed) return { label: null };
  if (trimmed.length > LABEL_MAX) return { error: `A name can be at most ${LABEL_MAX} characters` };
  return { label: trimmed };
}

/**
 * The name `viewerId` sees for `conversation`: their personal name, else the
 * shared name (group), else the other person's name (direct). A workday has
 * no stored name — null here, and the client formats its `dateKey`.
 *
 * @param {object} conversation
 * @param {string} viewerId
 * @param {{ personalLabel?: string | null, nameOf?: (userId: string) => string | null }} [context]
 */
export function displayLabel(conversation, viewerId, { personalLabel = null, nameOf = () => null } = {}) {
  if (personalLabel) return personalLabel;
  if (conversation.kind === 'group') return conversation.label ?? null;
  if (conversation.kind === 'direct') {
    const other = (conversation.memberIds ?? []).find((id) => id !== viewerId);
    return other ? nameOf(other) : null;
  }
  return null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Why `dateKey` can't start a huddle, or null if it can. It is the starter's
 * local date, so it must be a real YYYY-MM-DD within a day of the server's UTC
 * date (every time zone is), and not earlier than the open workday's — a
 * device with the wrong date must not close today's workday (#866 R9).
 *
 * @param {unknown} dateKey
 * @param {string | null} openDateKey  the open workday's date, if one is open
 * @param {Date} now
 */
export function checkStartDateKey(dateKey, openDateKey, now) {
  if (typeof dateKey !== 'string' || !DATE_KEY_RE.test(dateKey)) {
    return 'dateKey must be a YYYY-MM-DD date';
  }
  const ms = Date.parse(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(ms) || utcDateKey(ms) !== dateKey) return 'dateKey is not a real date';
  const today = Date.parse(`${utcDateKey(now)}T00:00:00Z`);
  if (Math.abs(ms - today) > DAY_MS) return "dateKey must be within a day of today's date";
  if (openDateKey && dateKey < openDateKey) {
    return 'dateKey is earlier than the workday already open';
  }
  return null;
}

/** "2026-11-12" for `date`, in UTC — the server has no team timezone to use. */
export function utcDateKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

/**
 * The calendar day an existing post belongs to, for mapping old posts onto
 * workdays: its `postDate` (the sender's local date) when it has one, else the
 * UTC date it went out. Mirrors the client's `getPostDateKey`, minus the local
 * timezone the server doesn't know.
 */
export function legacyDateKeyFor(post) {
  if (typeof post.postDate === 'string' && DATE_KEY_RE.test(post.postDate)) return post.postDate;
  return utcDateKey(post.deliveredAt ?? post.createdAt);
}
