import { ObjectId } from "mongodb";

// Phase 3 will add full team management routes.
// This model is added now so ticket auth can check team membership.

export interface Team {
  _id: ObjectId;
  name: string;
  description?: string;
  members: string[]; // userId strings
  admins: string[]; // userId strings
  code: string;
  isPersonal?: boolean;
  createdAt: Date;
  updatedAt?: Date;
}
