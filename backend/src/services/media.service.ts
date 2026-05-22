import { ObjectId } from "mongodb";
import { mediaItemsCollection } from "../models/index.js";
import type { MediaItem, MediaItemType } from "../models/media-item.model.js";

function isValidId(id: string): boolean {
  return /^[0-9a-f]{24}$/i.test(id);
}

export function toPublicMediaItem(m: MediaItem) {
  return {
    id: m._id.toHexString(),
    userId: m.userId,
    type: m.type,
    mimeType: m.mimeType,
    url: m.url,
    videoid: m.videoid ?? null,
    filename: m.filename,
    size: m.size,
    title: m.title ?? null,
    caption: m.caption ?? null,
    altText: m.altText ?? null,
    thumbnail: m.thumbnail ?? null,
    uploadedAt: m.uploadedAt.toISOString(),
  };
}

export type PublicMediaItem = ReturnType<typeof toPublicMediaItem>;

export interface CreateMediaItemOpts {
  type: MediaItemType;
  mimeType: string;
  url: string;
  filename: string;
  size: number;
  videoid?: string;
  title?: string;
  caption?: string;
  thumbnail?: string;
}

export interface UpdateMediaItemOpts {
  title?: string;
  caption?: string;
  altText?: string;
}

export const mediaService = {
  async create(userId: string, opts: CreateMediaItemOpts): Promise<PublicMediaItem> {
    const doc: MediaItem = {
      _id: new ObjectId(),
      userId,
      type: opts.type,
      mimeType: opts.mimeType,
      url: opts.url,
      filename: opts.filename,
      size: opts.size,
      ...(opts.videoid ? { videoid: opts.videoid } : {}),
      ...(opts.title ? { title: opts.title } : {}),
      ...(opts.caption ? { caption: opts.caption } : {}),
      ...(opts.thumbnail ? { thumbnail: opts.thumbnail } : {}),
      uploadedAt: new Date(),
    };
    await mediaItemsCollection().insertOne(doc);
    return toPublicMediaItem(doc);
  },

  async getForUser(userId: string, limit = 50): Promise<PublicMediaItem[]> {
    const docs = await mediaItemsCollection()
      .find({ userId })
      .sort({ uploadedAt: -1 })
      .limit(limit)
      .toArray();
    return docs.map(toPublicMediaItem);
  },

  async findById(id: string): Promise<PublicMediaItem | null> {
    if (!isValidId(id)) return null;
    const doc = await mediaItemsCollection().findOne({ _id: new ObjectId(id) });
    return doc ? toPublicMediaItem(doc) : null;
  },

  async ensureOwned(userId: string, id: string): Promise<"ok" | "not-found" | "forbidden"> {
    if (!isValidId(id)) return "not-found";
    const doc = await mediaItemsCollection().findOne({ _id: new ObjectId(id) });
    if (!doc) return "not-found";
    if (doc.userId !== userId) return "forbidden";
    return "ok";
  },

  async remove(userId: string, id: string): Promise<"ok" | "not-found" | "forbidden"> {
    if (!isValidId(id)) return "not-found";
    const coll = mediaItemsCollection();
    const doc = await coll.findOne({ _id: new ObjectId(id) });
    if (!doc) return "not-found";
    if (doc.userId !== userId) return "forbidden";
    await coll.deleteOne({ _id: doc._id });
    return "ok";
  },

  async setThumbnail(
    userId: string,
    id: string,
    thumbnailUrl: string
  ): Promise<PublicMediaItem | "not-found" | "forbidden"> {
    const ownership = await this.ensureOwned(userId, id);
    if (ownership !== "ok") return ownership;
    const coll = mediaItemsCollection();
    const docId = new ObjectId(id);
    const updated = await coll.findOneAndUpdate(
      { _id: docId },
      { $set: { thumbnail: thumbnailUrl } },
      { returnDocument: "after" }
    );
    return updated ? toPublicMediaItem(updated) : "not-found";
  },

  async update(
    userId: string,
    id: string,
    opts: UpdateMediaItemOpts
  ): Promise<PublicMediaItem | "not-found" | "forbidden"> {
    if (!isValidId(id)) return "not-found";
    const coll = mediaItemsCollection();
    const doc = await coll.findOne({ _id: new ObjectId(id) });
    if (!doc) return "not-found";
    if (doc.userId !== userId) return "forbidden";
    const $set: Partial<MediaItem> = {};
    if (opts.title !== undefined) $set.title = opts.title;
    if (opts.caption !== undefined) $set.caption = opts.caption;
    if (opts.altText !== undefined) $set.altText = opts.altText;
    const updated = await coll.findOneAndUpdate(
      { _id: doc._id },
      { $set },
      { returnDocument: "after" }
    );
    return updated ? toPublicMediaItem(updated) : "not-found";
  },
};
