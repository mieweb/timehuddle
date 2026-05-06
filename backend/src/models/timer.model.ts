import { ObjectId } from "mongodb";

/**
 * Timer — one running or completed segment of work.
 *
 * Timers are the canonical ledger. Running timers (endTime: null) are
 * immutable except for being closed. Closed timers may be edited in MVP.
 * Do not reopen a closed timer.
 */
export interface Timer {
  _id: ObjectId;
  workItemId: string; // parent WorkItem
  userId: string; // denormalized
  date: string; // denormalized UTC "YYYY-MM-DD" — same as parent WorkItem.date
  startTime: number; // epoch ms
  endTime: number | null; // null = running
  durationSeconds?: number; // cached on close only — never write on open
  createdAt: Date;
}
