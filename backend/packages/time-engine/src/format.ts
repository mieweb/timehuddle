/**
 * @timeharbor/time-engine — Display formatters
 *
 * Converts UTC epoch ms → local-centric display strings.
 * Uses Intl.DateTimeFormat (zero dependencies, works everywhere:
 * browser, WebView/Capacitor, Node.js).
 *
 * RULE: All data stays as UTC epoch ms internally.
 * These functions are the ONLY place where timezone conversion happens.
 *
 * Every function accepts an optional `timezone` parameter (IANA string,
 * e.g. "America/New_York"). When omitted, the user's local timezone is used.
 */

// ── Time ────────────────────────────────────────────────────────────────

/**
 * Format epoch ms as a local time string.
 * @example formatTime(ts) → "9:00 AM"
 * @example formatTime(ts, 'Asia/Kolkata') → "2:30 PM"
 */
export function formatTime(
  epochMs: number,
  timezone?: string
): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(epochMs);
}

/**
 * Format epoch ms as a local time string with seconds.
 * @example formatTimeFull(ts) → "9:00:45 AM"
 */
export function formatTimeFull(
  epochMs: number,
  timezone?: string
): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(epochMs);
}

// ── Date ────────────────────────────────────────────────────────────────

/**
 * Format epoch ms as a local date string.
 * @example formatDate(ts) → "Mar 20, 2026"
 */
export function formatDate(
  epochMs: number,
  timezone?: string
): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(epochMs);
}

/**
 * Format epoch ms as a short date (no year).
 * @example formatDateShort(ts) → "Mar 20"
 */
export function formatDateShort(
  epochMs: number,
  timezone?: string
): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(epochMs);
}

// ── Date + Time ─────────────────────────────────────────────────────────

/**
 * Format epoch ms as a local date + time string.
 * @example formatDateTime(ts) → "Mar 20, 2026, 9:00 AM"
 */
export function formatDateTime(
  epochMs: number,
  timezone?: string
): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(epochMs);
}

// ── Time Range ──────────────────────────────────────────────────────────

/**
 * Format a time range as local time.
 * @example formatTimeRange(start, end)  → "9:00 AM – 12:30 PM"
 * @example formatTimeRange(start, null) → "9:00 AM – now"
 */
export function formatTimeRange(
  startMs: number,
  endMs: number | null,
  timezone?: string
): string {
  const opts: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
    ...(timezone ? { timeZone: timezone } : {}),
  };
  const fmt = new Intl.DateTimeFormat(undefined, opts);
  const startStr = fmt.format(startMs);
  if (endMs === null) return `${startStr} – now`;
  const endStr = fmt.format(endMs);
  return `${startStr} – ${endStr}`;
}

// ── Duration ────────────────────────────────────────────────────────────

/**
 * Format milliseconds as a human-readable duration.
 * @example formatDuration(12600000) → "3h 30m"
 * @example formatDuration(900000)   → "15m"
 * @example formatDuration(45000)    → "0m"
 * @example formatDuration(0)        → "0m"
 */
export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/**
 * Format milliseconds as H:MM:SS (for live timer display).
 * @example formatDurationClock(12600000) → "3:30:00"
 * @example formatDurationClock(75000)    → "0:01:15"
 */
export function formatDurationClock(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// ── YYYY-MM-DD ──────────────────────────────────────────────────────────

/**
 * Convert epoch ms to a YYYY-MM-DD string in the given timezone.
 * This is for the `date` field on session documents — it must reflect
 * the LOCAL date (so a clock-in at 11pm local shows on that day, not the next).
 *
 * @example toLocalDateString(ts)                   → "2026-03-20"
 * @example toLocalDateString(ts, 'Asia/Kolkata')   → "2026-03-21" (past midnight there)
 */
export function toLocalDateString(
  epochMs: number,
  timezone?: string
): string {
  // Use Intl to get year/month/day in the target timezone
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(epochMs);
  // en-CA formats as YYYY-MM-DD natively
  return parts;
}

// ── UTC helpers (for backend) ───────────────────────────────────────────

/**
 * Convert epoch ms to an ISO 8601 UTC string.
 * Use this when the backend needs to store/log timestamps as strings.
 * @example toUTCString(1742457600000) → "2026-03-20T09:00:00.000Z"
 */
export function toUTCString(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/**
 * Get the current time as UTC epoch ms.
 * This is the ONLY function in the engine that reads the system clock.
 * Use it to generate `referenceTime` for computeSession/computeDay.
 */
export function nowUTC(): number {
  return Date.now();
}
