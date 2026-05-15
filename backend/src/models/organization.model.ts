import { ObjectId } from "mongodb";

export interface Organization {
  _id: ObjectId;
  name: string;
  key: string;
  createdAt: Date;
  updatedAt?: Date;
}
