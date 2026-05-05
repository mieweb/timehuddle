import { ObjectId } from "mongodb";

/**
 * TimerSession — one running or completed segment of work.
 *
 * Sessions are the canonical ledger. Running sessions (endTime: null) are
 * immutable except for being closed. Closed sessions may be edited in MVP.
 * Do not reopen a closed session.
 */
export interface TimerSession {
  _id: ObjectId;
  timeEntryId: string; // parent TimeEntry
  userId: string; // denormalized
  date: string; // denormalized UTC "YYYY-MM-DD" — same as parent TimeEntry.date
  startTime: number; // epoch ms
  endTime: number | null; // null = running
  durationSeconds?: number; // cached on close only — never write on open
  createdAt: Date;
}
