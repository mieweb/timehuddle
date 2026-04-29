import { FastifyRequest, FastifyReply } from "fastify";
import { ObjectId } from "mongodb";
import { ticketsCollection } from "../models/index.js";
import type { Ticket } from "../models/ticket.model.js";

export const ticketController = {
  async createTicket(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const now = new Date();
    const { title, description, status, priority, link, projectId } = req.body as {
      title: string;
      description?: string;
      status?: Ticket["status"];
      priority?: Ticket["priority"];
      link?: string;
      projectId?: string;
    };

    const doc: Omit<Ticket, "_id"> = {
      title,
      description,
      status: status ?? "Open",
      priority: priority ?? "Medium",
      link,
      projectId,
      createdBy: userId,
      source: "timeharbor",
      fieldTimestamps: { title: now, status: now, priority: now },
      _conflicts: [],
      _deleted: false,
      _rev: 1,
      createdAt: now,
      updatedAt: now,
    };

    const result = await ticketsCollection().insertOne(doc as Ticket);
    reply.status(201).send({ ticket: { _id: result.insertedId, ...doc } });
  },

  async listTickets(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const query = req.query as { status?: string };
    const filter: Record<string, unknown> = { createdBy: userId, _deleted: false };
    if (query.status) {
      filter.status = query.status;
    }

    const tickets = await ticketsCollection()
      .find(filter)
      .sort({ updatedAt: -1 })
      .toArray();

    reply.send({ tickets });
  },

  async updateTicket(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const { ticketId } = req.params as { ticketId: string };
    const { fieldTimestamps: incomingTs, ...fields } = req.body as {
      title?: string;
      description?: string;
      status?: Ticket["status"];
      priority?: Ticket["priority"];
      link?: string;
      projectId?: string;
      fieldTimestamps?: Record<string, string>;
    };

    let oid: ObjectId;
    try {
      oid = new ObjectId(ticketId);
    } catch {
      return reply.status(400).send({ error: "Invalid ticket ID" });
    }

    const existing = await ticketsCollection().findOne({
      _id: oid,
      createdBy: userId,
      _deleted: false,
    });
    if (!existing) {
      return reply.status(404).send({ error: "Ticket not found" });
    }

    // Field-timestamp merge: only apply fields whose incoming timestamp is newer
    const $set: Record<string, unknown> = { updatedAt: new Date() };
    const mergedTs = { ...existing.fieldTimestamps };

    for (const [field, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      const incomingDate = incomingTs?.[field]
        ? new Date(incomingTs[field])
        : new Date();
      const existingDate = mergedTs[field];

      if (!existingDate || incomingDate >= existingDate) {
        $set[field] = value;
        mergedTs[field] = incomingDate;
      }
    }
    $set.fieldTimestamps = mergedTs;

    const result = await ticketsCollection().findOneAndUpdate(
      { _id: oid },
      { $set, $inc: { _rev: 1 } },
      { returnDocument: "after" }
    );

    reply.send({ ticket: result });
  },

  async deleteTicket(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const { ticketId } = req.params as { ticketId: string };

    let oid: ObjectId;
    try {
      oid = new ObjectId(ticketId);
    } catch {
      return reply.status(400).send({ error: "Invalid ticket ID" });
    }

    const result = await ticketsCollection().findOneAndDelete(
      { _id: oid, createdBy: userId, _deleted: false },
    );

    if (!result) {
      return reply.status(404).send({ error: "Ticket not found" });
    }

    reply.send({ ok: true });
  },

  // ── Sync endpoints ──

  async pushTickets(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const now = new Date();
    let accepted = 0;
    const serverIds: Record<string, string> = {};
    const body = req.body as {
      tickets: Array<{
        clientId: string;
        _serverId?: string;
        title: string;
        description?: string;
        status: Ticket["status"];
        priority: Ticket["priority"];
        link?: string;
        projectId?: string;
        fieldTimestamps: Record<string, string>;
        _deleted: boolean;
        _rev: number;
      }>;
    };

    for (const incoming of body.tickets) {
      const incomingTs: Record<string, Date> = {};
      for (const [k, v] of Object.entries(incoming.fieldTimestamps)) {
        incomingTs[k] = new Date(v);
      }

      if (incoming._serverId) {
        // Update existing
        let oid: ObjectId;
        try {
          oid = new ObjectId(incoming._serverId);
        } catch {
          continue;
        }

        const existing = await ticketsCollection().findOne({
          _id: oid,
          createdBy: userId,
        });
        if (!existing) continue;

        const $set: Record<string, unknown> = { updatedAt: now };
        const mergedTs = { ...existing.fieldTimestamps };
        const archiveFields: Record<string, unknown> = {};

        for (const field of [
          "title",
          "description",
          "status",
          "priority",
          "link",
          "projectId",
          "_deleted",
        ] as const) {
          const val = incoming[field as keyof typeof incoming];
          if (val === undefined) continue;
          const inc = incomingTs[field];
          const ext = mergedTs[field];
          if (!ext || (inc && inc >= ext)) {
            $set[field] = val;
            if (inc) mergedTs[field] = inc;
          } else {
            archiveFields[field] = val;
          }
        }
        $set.fieldTimestamps = mergedTs;

        // If _deleted won the merge, hard-delete from MongoDB
        if ($set._deleted === true) {
          await ticketsCollection().deleteOne({ _id: oid });
        } else {
          const update: Record<string, unknown> = { $set, $inc: { _rev: 1 } };
          if (Object.keys(archiveFields).length > 0) {
            update.$push = {
              _conflicts: { fields: archiveFields, ts: incomingTs, at: now },
            };
          }

          await ticketsCollection().updateOne({ _id: oid }, update);
        }
        serverIds[incoming.clientId] = incoming._serverId;
        accepted++;
      } else {
        // If the incoming ticket is already deleted, skip inserting it
        if (incoming._deleted) {
          accepted++;
          continue;
        }
        // Insert new
        const doc: Omit<Ticket, "_id"> = {
          title: incoming.title,
          description: incoming.description,
          status: incoming.status ?? "Open",
          priority: incoming.priority ?? "Medium",
          link: incoming.link,
          projectId: incoming.projectId,
          createdBy: userId,
          source: "timeharbor",
          fieldTimestamps: incomingTs,
          _conflicts: [],
          _deleted: false,
          _rev: 1,
          createdAt: now,
          updatedAt: now,
        };
        const result = await ticketsCollection().insertOne(doc as Ticket);
        serverIds[incoming.clientId] = result.insertedId.toString();
        accepted++;
      }
    }

    reply.send({ accepted, serverIds });
  },

  async pullTickets(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const body = req.body as { lastPulledAt?: string };
    const since = body.lastPulledAt
      ? new Date(body.lastPulledAt)
      : new Date(0);

    const tickets = await ticketsCollection()
      .find({ createdBy: userId, updatedAt: { $gt: since } })
      .sort({ updatedAt: 1 })
      .toArray();

    reply.send({ tickets, serverTime: new Date().toISOString() });
  },
};
