import { ObjectId } from "mongodb";

export interface Organization {
  _id: ObjectId;
  name: string;
  key: string;
  owners?: string[];
  admins?: string[];
  createdAt: Date;
  updatedAt?: Date;
}
