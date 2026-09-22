/** "YYYY-MM-DD" in the browser's local timezone — never use toISOString() for
 * this, which is UTC and drifts a calendar day off local time for hours
 * around midnight in any timezone behind UTC. */
export function toLocalDateStr(d: Date): string {
  return d.toLocaleDateString('en-CA');
}

/** Short relative time ("3m ago", "2d ago"), falling back to a date past a week. */
export function timeAgo(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(diffMs / 86_400_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
