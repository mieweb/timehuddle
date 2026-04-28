import type { ObjectId } from "mongodb";

export interface Notification {
  _id: ObjectId;
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  read: boolean;
  createdAt: Date;
}

export interface PublicNotification {
  id: string;
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  read: boolean;
  createdAt: string; // ISO string
}
