/**
 * Work Summary routes — /v1/work/summary/*
 *
 * Plain-English recaps of recent timer work.
 * Designed to grow: user summaries today, team summaries next.
 *
 * Routes:
 *   GET /v1/work/summary/user/:userId  — last 48 h for one user
 *   GET /v1/work/summary/team/:teamId  — (future) last 48 h across a team
 */
import type { FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";
import { requireAuth } from "../middleware/require-auth.js";
import {
  teamsCollection,
  ticketsCollection,
  timersCollection,
  workItemsCollection,
} from "../models/index.js";

export async function workRoutes(app: FastifyInstance) {
  // GET /v1/work/summary/user/:userId
  app.get(
    "/work/summary/user/:userId",
    {
      onRequest: [requireAuth],
      schema: {
        tags: ["Work Summary"],
        summary: "Plain-English summary of a user's last 48 h of timer work",
        params: {
          type: "object",
          required: ["userId"],
          properties: { userId: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    title: { type: "string" },
                  },
                },
              },
            },
          },
          403: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (req, reply) => {
      const viewer = (req as any).user as { id: string };
      const { userId: targetId } = req.params as { userId: string };

      if (viewer.id !== targetId) {
        const sharedTeam = await teamsCollection().findOne({
          members: { $all: [viewer.id, targetId] },
          isPersonal: { $ne: true },
        });
        if (!sharedTeam) {
          return reply.status(403).send({ error: "Forbidden." });
        }
      }

      const since = Date.now() - 48 * 60 * 60 * 1000;

      const recentTimers = await timersCollection()
        .find({
          userId: targetId,
          $or: [{ endTime: { $gte: since } }, { endTime: null }],
          startTime: { $gte: since - 24 * 60 * 60 * 1000 },
        })
        .project<{ workItemId: string }>({ workItemId: 1 })
        .toArray();

      if (recentTimers.length === 0) return { items: [] };

      const workItemIds = [...new Set(recentTimers.map((t) => t.workItemId))];

      const workItems = await workItemsCollection()
        .find({ _id: { $in: workItemIds.map((id) => new ObjectId(id)) } })
        .project<{ ticketId: string }>({ ticketId: 1 })
        .toArray();

      const ticketIds = [...new Set(workItems.map((w) => w.ticketId))];

      const tickets = await ticketsCollection()
        .find({ _id: { $in: ticketIds.map((id) => new ObjectId(id)) } })
        .project<{ _id: ObjectId; title: string }>({ _id: 1, title: 1 })
        .toArray();

      return {
        items: tickets.map((t) => ({ id: t._id.toHexString(), title: t.title })),
      };
    }
  );
}
