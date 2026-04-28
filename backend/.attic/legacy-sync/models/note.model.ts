import { ObjectId } from "mongodb";

export interface Note {
  _id: ObjectId;
  title: string;
  content: string; // JSON string (BlockNote document)
  createdBy: string;
  _deleted: boolean;
  _rev: number;
  createdAt: Date;
  updatedAt: Date;
}
