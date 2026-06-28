import { ObjectId } from "mongodb";

// ── User record ──

export interface OrgBlock {
  orgId: string;
  blockedBy: string;
  blockedAt: Date;
  reason?: string;
}

export interface User {
  _id: ObjectId;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  /** Canonical username/handle — null until the user claims one. Globally unique. */
  username?: string | null;
  bio?: string;
  website?: string;
  reportsToUserId?: string | null;
  /** Array of org-level blocks. User is blocked from accessing orgs in this list. */
  blocked?: OrgBlock[];
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
