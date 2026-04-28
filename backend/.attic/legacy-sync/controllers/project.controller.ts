import { FastifyRequest, FastifyReply } from "fastify";
import { ObjectId } from "mongodb";
import { projectsCollection } from "../models/index.js";
import type { Project } from "../models/project.model.js";

export const projectController = {
  async pushProjects(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const now = new Date();
    let accepted = 0;
    const serverIds: Record<string, string> = {};

    const body = req.body as {
      projects: Array<{
        clientId: string;
        _serverId?: string;
        name: string;
        description?: string;
        status: Project["status"];
        color: Project["color"];
        prefix: string;
        repoUrl?: string;
        _rev: number;
        _deleted: boolean;
      }>;
    };

    for (const incoming of body.projects) {
      if (incoming._serverId) {
        let oid: ObjectId;
        try {
          oid = new ObjectId(incoming._serverId);
        } catch {
          continue;
        }

        const existing = await projectsCollection().findOne({
          _id: oid,
          createdBy: userId,
        });
        if (!existing) continue;

        if (incoming._rev >= existing._rev) {
          if (incoming._deleted) {
            await projectsCollection().deleteOne({ _id: oid });
          } else {
            await projectsCollection().updateOne(
              { _id: oid },
              {
                $set: {
                  name: incoming.name,
                  description: incoming.description,
                  status: incoming.status,
                  color: incoming.color,
                  prefix: incoming.prefix,
                  repoUrl: incoming.repoUrl,
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
        // If the incoming project is already deleted, skip inserting it
        if (incoming._deleted) {
          accepted++;
          continue;
        }
        const doc: Omit<Project, "_id"> = {
          name: incoming.name,
          description: incoming.description,
          status: incoming.status ?? "Active",
          color: incoming.color ?? "blue",
          prefix: incoming.prefix ?? "PROJ",
          repoUrl: incoming.repoUrl,
          createdBy: userId,
          _deleted: false,
          _rev: 1,
          createdAt: now,
          updatedAt: now,
        };
        const result = await projectsCollection().insertOne(doc as Project);
        serverIds[incoming.clientId] = result.insertedId.toString();
        accepted++;
      }
    }

    reply.send({ accepted, serverIds });
  },

  async pullProjects(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const body = req.body as { lastPulledAt?: string };
    const since = body.lastPulledAt
      ? new Date(body.lastPulledAt)
      : new Date(0);

    const projects = await projectsCollection()
      .find({ createdBy: userId, updatedAt: { $gt: since } })
      .sort({ updatedAt: 1 })
      .toArray();

    reply.send({ projects, serverTime: new Date().toISOString() });
  },
};
