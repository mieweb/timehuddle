import { ObjectId } from "mongodb";

export interface HuddleComment {
  _id: ObjectId;
  postId: string; // hex string of the huddle post _id
  userId: string; // author of the comment
  content: string; // markdown text
  mentions: string[]; // array of userId strings
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicHuddleComment {
  id: string;
  postId: string;
  userId: string;
  userName: string;
  userInitials: string;
  userAvatarUrl?: string;
  content: string;
  mentions: string[];
  createdAt: string; // ISO
  updatedAt: string; // ISO
}
