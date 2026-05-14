import { ObjectId } from "mongodb";

export interface PersonalAccessToken {
  _id: ObjectId;
  userId: string;
  tokenHash: string; // SHA-256 of raw token — never stored in plaintext
  name: string;
  lastUsedAt?: Date;
  createdAt: Date;
}
