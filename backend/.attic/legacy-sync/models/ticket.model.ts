import { ObjectId } from "mongodb";

export interface Ticket {
  _id: ObjectId;
  title: string;
  description?: string;
  status: "Open" | "In Progress" | "Closed";
  priority: "Low" | "Medium" | "High";
  link?: string;
  projectId?: string;
  createdBy: string;
  source: "timeharbor";
  fieldTimestamps: Record<string, Date>;
  _conflicts: unknown[];
  _deleted: boolean;
  _rev: number;
  createdAt: Date;
  updatedAt: Date;
}
