import { FastifyRequest, FastifyReply } from "fastify";
import { ObjectId } from "mongodb";
import { notesCollection } from "../models/index.js";
import type { Note } from "../models/note.model.js";

export const noteController = {
  async pushNotes(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const now = new Date();
    let accepted = 0;
    const serverIds: Record<string, string> = {};

    const body = req.body as {
      notes: Array<{
        clientId: string;
        _serverId?: string;
        title: string;
        content: string;
        _rev: number;
        _deleted: boolean;
      }>;
    };

    for (const incoming of body.notes) {
      if (incoming._serverId) {
        let oid: ObjectId;
        try {
          oid = new ObjectId(incoming._serverId);
        } catch {
          continue;
        }

        const existing = await notesCollection().findOne({
          _id: oid,
          createdBy: userId,
        });
        if (!existing) continue;

        if (incoming._rev >= existing._rev) {
          if (incoming._deleted) {
            await notesCollection().deleteOne({ _id: oid });
          } else {
            await notesCollection().updateOne(
              { _id: oid },
              {
                $set: {
                  title: incoming.title,
                  content: incoming.content,
                  updatedAt: now,
                },
                $inc: { _rev: 1 },
              },
            );
          }
        }
        serverIds[incoming.clientId] = incoming._serverId;
        accepted++;
      } else {
        // If the incoming note is already deleted, skip inserting it
        if (incoming._deleted) {
          accepted++;
          continue;
        }
        const doc: Omit<Note, "_id"> = {
          title: incoming.title,
          content: incoming.content,
          createdBy: userId,
          _deleted: false,
          _rev: 1,
          createdAt: now,
          updatedAt: now,
        };
        const result = await notesCollection().insertOne(doc as Note);
        serverIds[incoming.clientId] = result.insertedId.toString();
        accepted++;
      }
    }

    reply.send({ accepted, serverIds });
  },

  async pullNotes(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const body = req.body as { lastPulledAt?: string };
    const since = body.lastPulledAt
      ? new Date(body.lastPulledAt)
      : new Date(0);

    const notes = await notesCollection()
      .find({ createdBy: userId, updatedAt: { $gt: since } })
      .sort({ updatedAt: 1 })
      .toArray();

    reply.send({ notes, serverTime: new Date().toISOString() });
  },
};
