import type { RawSession, SessionStats, TicketTime } from './types.js';

/**
 * Compute stats for a single work session.
 *
 * PURE FUNCTION — no side effects, no Date.now(), no I/O.
 * Pass `referenceTime` (epoch ms) for open sessions.
 *
 * @param session  Raw session data (clockIn, clockOut, ticketSegments, breaks)
 * @param referenceTime  epoch ms — used as virtual clockOut/end for open items
 * @returns Computed session statistics
 */
export function computeSession(
  session: RawSession,
  referenceTime: number
): SessionStats {
  const clockOut = session.clockOut ?? referenceTime;
  const totalSessionMs = Math.max(0, clockOut - session.clockIn);

  // Sum break time
  const totalBreakMs = session.breaks.reduce((sum, b) => {
    const bEnd = b.end ?? referenceTime;
    return sum + Math.max(0, bEnd - b.start);
  }, 0);

  // Per-segment time with break overlap subtracted
  const segmentTimes: TicketTime[] = session.ticketSegments.map((seg) => {
    const segEnd = seg.end ?? referenceTime;
    const segDuration = Math.max(0, segEnd - seg.start);

    // Subtract any break time that overlaps this segment's time range
    const breakOverlap = session.breaks.reduce((sum, b) => {
      const bStart = b.start;
      const bEnd = b.end ?? referenceTime;
      const overlapStart = Math.max(seg.start, bStart);
      const overlapEnd = Math.min(segEnd, bEnd);
      return sum + Math.max(0, overlapEnd - overlapStart);
    }, 0);

    return {
      ticketId: seg.ticketId,
      ticketTitle: seg.ticketTitle,
      totalMs: Math.max(0, segDuration - breakOverlap),
    };
  });

  // Merge segments for the same ticket (user may work on a ticket,
  // take a break, resume the same ticket — that's 2 segments, 1 ticket)
  const merged = new Map<string, TicketTime>();
  for (const t of segmentTimes) {
    const existing = merged.get(t.ticketId);
    if (existing) {
      existing.totalMs += t.totalMs;
    } else {
      merged.set(t.ticketId, { ...t });
    }
  }
  const ticketBreakdown = Array.from(merged.values());

  const ticketTotal = ticketBreakdown.reduce((s, t) => s + t.totalMs, 0);
  const netWorkMs = Math.max(0, totalSessionMs - totalBreakMs);
  const untrackedMs = Math.max(0, netWorkMs - ticketTotal);

  const lastBreak = session.breaks.at(-1);
  const activeSegment = session.ticketSegments.find((s) => s.end === null);

  return {
    totalSessionMs,
    totalBreakMs,
    netWorkMs,
    ticketBreakdown,
    untrackedMs,
    isOpen: session.clockOut === null,
    isOnBreak: lastBreak != null && lastBreak.end === null,
    activeTicketId: activeSegment?.ticketId ?? null,
  };
}
