import { ObjectId } from "mongodb";

export interface HuddlePost {
  _id: ObjectId;
  teamId: string;
  userId: string;
  content: {
    text: string;
    mentions: string[]; // array of userId strings
  };
  ticketId?: string;
  attachments: Array<{
    mediaId: string;
    type: "image" | "video" | "file";
    url: string;
    thumbnailUrl?: string;
    filename?: string;
  }>;
  likes?: string[]; // array of userId strings who liked this post
  commentCount?: number; // denormalized count for performance
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicHuddlePost {
  id: string;
  teamId: string;
  userId: string;
  userName: string;
  userInitials: string;
  content: {
    text: string;
    mentions: string[];
  };
  ticketId?: string;
  ticketTitle?: string;
  attachments: Array<{
    mediaId: string;
    type: "image" | "video" | "file";
    url: string;
    thumbnailUrl?: string;
    filename?: string;
  }>;
  likes: string[]; // array of userId strings
  commentCount: number;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}
