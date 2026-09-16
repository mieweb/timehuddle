/** "YYYY-MM-DD" in the browser's local timezone — never use toISOString() for
 * this, which is UTC and drifts a calendar day off local time for hours
 * around midnight in any timezone behind UTC. */
export function toLocalDateStr(d: Date): string {
  return d.toLocaleDateString('en-CA');
}

/** Coarse relative time, e.g. "3h ago". */
export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}
