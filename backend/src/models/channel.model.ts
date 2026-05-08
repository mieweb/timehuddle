import { ObjectId } from "mongodb";

export interface Channel {
  _id: ObjectId;
  teamId: string;
  name: string; // e.g. "general"
  description?: string;
  isDefault: boolean;
  /** If set, only these userIds can access the channel. Empty/missing = all team members. */
  members?: string[];
  createdBy: string; // userId
  createdAt: Date;
}

export interface PublicChannel {
  id: string;
  teamId: string;
  name: string;
  description?: string;
  isDefault: boolean;
  /** userIds who can access this channel; empty array means team-wide */
  members: string[];
  createdBy: string;
  createdAt: string; // ISO
}
