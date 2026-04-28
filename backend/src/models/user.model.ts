import { ObjectId } from "mongodb";

// ── User record ──

export interface User {
  _id: ObjectId;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  bio?: string;
  website?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ── Session record ──

export interface Session {
  _id: ObjectId;
  userId: string;
  token: string;
  expiresAt: Date;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
  updatedAt: Date;
}
