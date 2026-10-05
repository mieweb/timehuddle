/**
 * Duplicate open shifts — which ones to end, and when.
 *
 * Before the one-open-shift-per-team index existed, two racing `clock.start`
 * calls could both insert. This decides how the startup cleanup in clock.js
 * resolves them: per (user, team) the newest shift is kept, and each older one
 * ends where the next one began, so no hours overlap.
 *
 * Free of Meteor and Mongo imports so it can be unit tested without a running
 * server (see tests/open-shift-dedupe.test.ts).
 */

const idOf = (shift) =>
  typeof shift._id?.toHexString === 'function' ? shift._id.toHexString() : String(shift._id);

/**
 * Plan the closures for a set of open shifts.
 *
 * @template {{ _id: unknown, userId: string, teamId: string, startTime: number }} T
 * @param {T[]} openShifts
 * @returns {Array<{ shift: T, endAt: number, keptId: string }>} one entry per
 *   shift to end, oldest first within each (user, team); shifts alone in their
 *   (user, team) are left out.
 */
export function planDuplicateShiftClosures(openShifts) {
  const groups = new Map();
  for (const shift of openShifts) {
    const key = `${shift.userId}\u0000${shift.teamId}`;
    const group = groups.get(key) ?? [];
    group.push(shift);
    groups.set(key, group);
  }

  const closures = [];
  for (const shifts of groups.values()) {
    if (shifts.length < 2) continue;
    // Oldest first; equal start times fall back to insertion order (the id).
    shifts.sort((a, b) => a.startTime - b.startTime || idOf(a).localeCompare(idOf(b)));
    const keptId = idOf(shifts[shifts.length - 1]);
    for (let i = 0; i < shifts.length - 1; i++) {
      const shift = shifts[i];
      closures.push({ shift, endAt: Math.max(shift.startTime, shifts[i + 1].startTime), keptId });
    }
  }
  return closures;
}
