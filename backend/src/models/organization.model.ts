import { ObjectId } from "mongodb";

export interface Organization {
  _id: ObjectId;
  name: string;
  key: string;
  owners?: string[];
  admins?: string[];
  installCompletedAt?: Date;
  createdAt: Date;
  updatedAt?: Date;
}
