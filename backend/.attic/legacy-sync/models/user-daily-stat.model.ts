import { ObjectId } from "mongodb";
import type { TicketTime } from "@timeharbor/time-engine";

export interface UserDailyStat {
  _id: ObjectId;
  userId: string;
  date: string; // YYYY-MM-DD
  totalSessionMs: number;
  totalBreakMs: number;
  netWorkMs: number;
  ticketBreakdown: TicketTime[];
  sessionCount: number;
}
