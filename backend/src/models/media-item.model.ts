import { ObjectId } from "mongodb";

export type MediaItemType = "video" | "image";

export interface ImageMeta {
  kind: "image";
  width: number;
  height: number;
}

export interface VideoMeta {
  kind: "video";
  width: number;
  height: number;
  duration: number;
}

export type MediaItemMetadata = ImageMeta | VideoMeta;

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

  thumbnail?: string;
  metadata?: MediaItemMetadata;
  uploadedAt: Date;
}
