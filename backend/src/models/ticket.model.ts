import { ObjectId } from "mongodb";

export type TicketStatus = "open" | "in-progress" | "blocked" | "reviewed" | "closed" | "deleted";
export type TicketPriority = "low" | "medium" | "high" | "critical";

export interface Ticket {
  _id: ObjectId;
  teamId: string;
  title: string;
  description?: string; // optional free-text description
  github: string; // URL or issue reference, empty string if none
  accumulatedTime: number; // seconds
  startTimestamp?: number; // epoch ms — present only while timer is running
  status: TicketStatus;
  priority?: TicketPriority;
  createdBy: string; // userId
  assignedTo: string | null; // userId
  reviewedBy?: string;
  reviewedAt?: Date;
  updatedBy?: string;
  createdAt: Date;
  updatedAt?: Date;
}
