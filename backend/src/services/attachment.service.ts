import { ObjectId } from "mongodb";
import { attachmentsCollection } from "../models/index.js";
import type { Attachment, AttachmentKind, AttachmentType } from "../models/attachment.model.js";

function isValidId(id: string): boolean {
  return /^[0-9a-f]{24}$/i.test(id);
}

export function toPublicAttachment(a: Attachment) {
  return {
    id: a._id.toHexString(),
    url: a.url,
    type: a.type,
    title: a.title ?? null,
    thumbnail: a.thumbnail ?? null,
    attachedTo: a.attachedTo,
    addedBy: a.addedBy,
    addedAt: a.addedAt.toISOString(),
  };
}

export type PublicAttachment = ReturnType<typeof toPublicAttachment>;

export const attachmentService = {
  async create(
    userId: string,
    url: string,
    type: AttachmentType,
    attachedTo: { kind: AttachmentKind; id: string },
    opts?: { title?: string; thumbnail?: string }
  ): Promise<PublicAttachment> {
    const doc: Attachment = {
      _id: new ObjectId(),
      url: url.trim(),
      type,
      ...(opts?.title ? { title: opts.title } : {}),
      ...(opts?.thumbnail ? { thumbnail: opts.thumbnail } : {}),
      attachedTo,
      addedBy: userId,
      addedAt: new Date(),
    };
    await attachmentsCollection().insertOne(doc);
    return toPublicAttachment(doc);
  },

  async getForEntity(
    kind: AttachmentKind,
    id: string
  ): Promise<PublicAttachment[]> {
    const docs = await attachmentsCollection()
      .find({ "attachedTo.kind": kind, "attachedTo.id": id })
      .sort({ addedAt: 1 })
      .toArray();
    return docs.map(toPublicAttachment);
  },

  async remove(userId: string, attachmentId: string): Promise<"ok" | "not-found" | "forbidden"> {
    if (!isValidId(attachmentId)) return "not-found";
    const coll = attachmentsCollection();
    const doc = await coll.findOne({ _id: new ObjectId(attachmentId) });
    if (!doc) return "not-found";
    if (doc.addedBy !== userId) return "forbidden";
    await coll.deleteOne({ _id: doc._id });
    return "ok";
  },
};
