import { ObjectId } from "mongodb";

/**
 * TimeEntry — one row per work item instance.
 *
 * Multiple entries for the same { userId, ticketId, date } are allowed.
 * Date is stored as UTC "YYYY-MM-DD" and used only as an index prefilter.
 * Day-total queries must use timezone-aware local-day boundaries.
 */
export interface TimeEntry {
  _id: ObjectId;
  userId: string;
  ticketId: string;
  date: string; // UTC "YYYY-MM-DD"
  note?: string;
  sortOrder?: number;
  createdAt: Date;
  updatedAt?: Date;
}
