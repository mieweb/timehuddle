import { ObjectId } from "mongodb";

export type ProjectStatus = "Active" | "On Hold" | "Completed" | "Archived";
export type ProjectColor =
  | "blue" | "green" | "purple" | "orange" | "red"
  | "teal" | "pink" | "yellow" | "indigo" | "gray";

export interface Project {
  _id: ObjectId;
  name: string;
  description?: string;
  status: ProjectStatus;
  color: ProjectColor;
  prefix: string;
  repoUrl?: string;
  createdBy: string;
  _deleted: boolean;
  _rev: number;
  createdAt: Date;
  updatedAt: Date;
}
