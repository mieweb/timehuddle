import { ObjectId } from "mongodb";

export interface Organization {
  _id: ObjectId;
  enterpriseId?: string;
  name: string;
  slug: string;
  owners?: string[];
  admins?: string[];
  allowAutoJoin?: boolean;
  createdAt: Date;
  updatedAt?: Date;
}
