import { ObjectId } from "mongodb";

export type TicketStatus = "open" | "reviewed" | "deleted" | "closed";

export interface Ticket {
  _id: ObjectId;
  teamId: string;
  title: string;
  github: string; // URL or issue reference, empty string if none
  accumulatedTime: number; // seconds
  startTimestamp?: number; // epoch ms — present only while timer is running
  status: TicketStatus;
  createdBy: string; // userId
  assignedTo: string | null; // userId
  reviewedBy?: string;
  reviewedAt?: Date;
  updatedBy?: string;
  createdAt: Date;
  updatedAt?: Date;
}
