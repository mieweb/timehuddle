/** Format seconds into "Xh Ym" or "Ym" or "0m" */
export function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0m';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Format seconds into "HH:MM:SS" for live timers */
export function formatTimer(totalSeconds: number): string {
  if (totalSeconds <= 0) return '00:00:00';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

/** Format a Date to "9:05 AM" style */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

/** Format a Date to "Jan 15" or "Jan 15, 2024" */
export function formatDate(date: Date, includeYear = false): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (includeYear) opts.year = 'numeric';
  return date.toLocaleDateString('en-US', opts);
}

/** Get start of day for a date */
export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Get end of day for a date */
export function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Get YYYY-MM-DD string from Date */
export function toDateString(date: Date): string {
  return date.toISOString().split('T')[0]!;
}
