import { ObjectId } from "mongodb";

export type MediaItemType = "video" | "image";

export interface MediaItem {
  _id: ObjectId;
  userId: string;
  type: MediaItemType;
  mimeType: string;
  url: string;
  /** videoid UUID — only set for TUS-uploaded videos */
  videoid?: string;
  filename: string;
  size: number;
  title?: string;
  caption?: string;
  /** Alt text for images (accessibility) */
  altText?: string;
  /** Image dimensions */
  width?: number;
  height?: number;
  /** Video duration in seconds */
  duration?: number;
  thumbnail?: string;
  uploadedAt: Date;
}
