import { ObjectId } from "mongodb";

export interface Enterprise {
  _id: ObjectId;
  name: string;
  slug: string;
  owners?: string[];
  admins?: string[];
  createdAt: Date;
  updatedAt?: Date;
}
