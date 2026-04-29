import type { RawSession, DayStats, TicketTime } from './types.js';
import { computeSession } from './computeSession.js';

/**
 * Compute aggregated stats for an entire day (sums multiple sessions).
 *
 * PURE FUNCTION — no side effects, no Date.now(), no I/O.
 *
 * @param sessions  All sessions for the day
 * @param date      YYYY-MM-DD string
 * @param referenceTime  epoch ms — for open sessions
 * @returns Aggregated day statistics
 */
export function computeDay(
  sessions: RawSession[],
  date: string,
  referenceTime: number
): DayStats {
  const results = sessions.map((s) => computeSession(s, referenceTime));

  // Merge ticket breakdowns across all sessions
  const merged = new Map<string, TicketTime>();
  for (const r of results) {
    for (const t of r.ticketBreakdown) {
      const existing = merged.get(t.ticketId);
      if (existing) {
        existing.totalMs += t.totalMs;
      } else {
        merged.set(t.ticketId, { ...t });
      }
    }
  }

  const totalSessionMs = results.reduce((s, r) => s + r.totalSessionMs, 0);
  const totalBreakMs = results.reduce((s, r) => s + r.totalBreakMs, 0);
  const netWorkMs = Math.max(0, totalSessionMs - totalBreakMs);
  const ticketBreakdown = Array.from(merged.values());
  const ticketTotal = ticketBreakdown.reduce((s, t) => s + t.totalMs, 0);

  return {
    date,
    totalSessionMs,
    totalBreakMs,
    netWorkMs,
    ticketBreakdown,
    untrackedMs: Math.max(0, netWorkMs - ticketTotal),
    sessionCount: sessions.length,
    hasOpenSession: results.some((r) => r.isOpen),
  };
}
