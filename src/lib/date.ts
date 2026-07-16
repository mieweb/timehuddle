/** "YYYY-MM-DD" in the browser's local timezone — never use toISOString() for
 * this, which is UTC and drifts a calendar day off local time for hours
 * around midnight in any timezone behind UTC. */
export function toLocalDateStr(d: Date): string {
  return d.toLocaleDateString('en-CA');
}
