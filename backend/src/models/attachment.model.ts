import { ObjectId } from "mongodb";

export type AttachmentKind = "clock" | "ticket";
export type AttachmentType = "video" | "image" | "link";

export interface Attachment {
  _id: ObjectId;
  url: string;
  type: AttachmentType;
  title?: string;
  thumbnail?: string;
  attachedTo: {
    kind: AttachmentKind;
    id: string;
  };
  addedBy: string; // userId
  addedAt: Date;
}
