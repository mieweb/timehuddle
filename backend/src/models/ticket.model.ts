import { ObjectId } from "mongodb";

export type TicketStatus = "open" | "in-progress" | "blocked" | "reviewed" | "closed" | "deleted";
export type TicketPriority = "low" | "medium" | "high" | "critical";

export interface Ticket {
  _id: ObjectId;
  teamId: string;
  title: string;
  description?: string; // optional free-text description
  github: string; // URL or issue reference, empty string if none
  status: TicketStatus;
  priority?: TicketPriority;
  createdBy: string; // userId
  assignedTo: string | null; // userId
  reviewedBy?: string;
  reviewedAt?: Date;
  updatedBy?: string;
  createdAt: Date;
  updatedAt?: Date;
  // Set to true when the ticket owner flags it for import into TimeHarbor.
  // TimeHarbor polls this field to decide which tickets to pull.
  sharedWithTimeharbor?: boolean;
}
