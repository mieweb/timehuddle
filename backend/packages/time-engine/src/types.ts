/**
 * @timeharbor/time-engine — Shared types
 *
 * All timestamps are UTC epoch milliseconds (number).
 * No Date objects, no ISO strings, no timezone math.
 */

/** A ticket time segment within a session */
export interface TicketSegment {
  segmentId: string;
  ticketId: string;
  ticketTitle: string;
  /** epoch ms — when tracking started on this ticket */
  start: number;
  /** epoch ms — null means currently active */
  end: number | null;
}

/** A break within a session */
export interface Break {
  breakId: string;
  /** epoch ms */
  start: number;
  /** epoch ms — null means currently on break */
  end: number | null;
}

/** Raw session data — the input to computeSession(). Client owns this. */
export interface RawSession {
  clockIn: number;
  clockOut: number | null;
  ticketSegments: TicketSegment[];
  breaks: Break[];
}

/** Per-ticket time breakdown */
export interface TicketTime {
  ticketId: string;
  ticketTitle: string;
  /** Segment time minus overlapping break time (ms) */
  totalMs: number;
}

/** Computed stats for a single session */
export interface SessionStats {
  /** Wall clock: clockOut - clockIn (ms) */
  totalSessionMs: number;
  /** Sum of all break durations (ms) */
  totalBreakMs: number;
  /** totalSessionMs - totalBreakMs (ms) */
  netWorkMs: number;
  /** Per-ticket time (segments merged by ticketId, break overlap subtracted) */
  ticketBreakdown: TicketTime[];
  /** netWorkMs - sum(ticketBreakdown) (ms) */
  untrackedMs: number;
  /** clockOut === null */
  isOpen: boolean;
  /** Last break has end === null */
  isOnBreak: boolean;
  /** Segment with end === null, or null */
  activeTicketId: string | null;
}

/** Aggregated stats for an entire day (sums multiple sessions) */
export interface DayStats {
  date: string;
  totalSessionMs: number;
  totalBreakMs: number;
  netWorkMs: number;
  ticketBreakdown: TicketTime[];
  untrackedMs: number;
  sessionCount: number;
  hasOpenSession: boolean;
}
