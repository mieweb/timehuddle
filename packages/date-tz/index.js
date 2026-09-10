/**
 * Timezone-aware day-boundary math — the single source of truth for both
 * the Meteor backend and the React frontend.
 *
 * A shift needs to be attributed to the calendar day it fell on *in the
 * employee's own timezone*, not UTC and not whichever browser happens to be
 * viewing it — otherwise the same shift can land on different days on
 * different screens (worst case, split across two days entirely) purely
 * because of where the viewer or the server happens to sit. See
 * packages/README.md.
 *
 * Built on date-fns-tz so DST transitions (23/25-hour local days) are
 * handled by a proven implementation rather than hand-rolled offset math.
 */

import { toZonedTime, fromZonedTime, formatInTimeZone } from 'date-fns-tz';

const UTC = 'UTC';

/** True when `timeZone` is a value Intl/date-fns-tz can actually resolve. */
export function isValidTimeZone(timeZone) {
  if (!timeZone || typeof timeZone !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Falls back to UTC on anything missing/invalid — never throws. */
function resolveTimeZone(timeZone) {
  return isValidTimeZone(timeZone) ? timeZone : UTC;
}

/**
 * The UTC epoch range `[startMs, endMs)` of the calendar day containing
 * `epochMs`, as measured in `timeZone`. `endMs` is the start of the next
 * local day (exclusive), so callers should filter with `$gte startMs` and
 * `$lt endMs`.
 */
export function getLocalDayBoundary(epochMs, timeZone) {
  const tz = resolveTimeZone(timeZone);
  const instant = new Date(epochMs);
  const zoned = toZonedTime(instant, tz);
  const y = zoned.getFullYear();
  const m = zoned.getMonth();
  const d = zoned.getDate();

  const startMs = fromZonedTime(new Date(y, m, d, 0, 0, 0, 0), tz).getTime();
  const endMs = fromZonedTime(new Date(y, m, d + 1, 0, 0, 0, 0), tz).getTime();
  return { startMs, endMs };
}

/** "YYYY-MM-DD" for the instant `epochMs`, as measured in `timeZone`. */
export function getLocalDateKey(epochMs, timeZone) {
  const tz = resolveTimeZone(timeZone);
  return formatInTimeZone(new Date(epochMs), tz, 'yyyy-MM-dd');
}
