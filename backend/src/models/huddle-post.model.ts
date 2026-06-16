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
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicHuddlePost {
  id: string;
  teamId: string;
  userId: string;
  content: {
    text: string;
    mentions: string[];
  };
  ticketId?: string;
  attachments: Array<{
    mediaId: string;
    type: "image" | "video" | "file";
    url: string;
    thumbnailUrl?: string;
    filename?: string;
  }>;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}
