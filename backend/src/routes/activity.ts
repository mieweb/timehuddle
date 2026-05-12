import type { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/require-auth.js";
import { teamsCollection } from "../models/index.js";
import { activityService } from "../services/activity.service.js";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const actorShape = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    avatar: { type: "string", nullable: true },
  },
};

const activityEventShape = {
  type: "object",
  properties: {
    id: { type: "string" },
    userId: { type: "string" },
    teamId: { type: "string", nullable: true },
    type: { type: "string" },
    actor: actorShape,
    payload: { type: "object", additionalProperties: true },
    occurredAt: { type: "string", format: "date-time" },
    source: { type: "string" },
  },
};

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function activityRoutes(app: FastifyInstance) {
  // GET /v1/activity/log
  app.get(
    "/activity/log",
    {
      onRequest: [requireAuth],
      schema: {
        tags: ["Activity"],
        summary: "Get activity log for the current user",
        description:
          "Returns a cursor-paginated list of activity events for the signed-in user, ordered newest first.",
        querystring: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
            before: {
              type: "string",
              description: "ISO 8601 cursor — return events older than this timestamp",
            },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              events: { type: "array", items: activityEventShape },
              nextCursor: { type: "string", nullable: true },
            },
          },
          401: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (req) => {
      // requireAuth attaches .user to the request — established pattern across all routes.
      const { id: userId } = (req as any).user;
      const { limit, before } = req.query as { limit?: number; before?: string };
      return activityService.getLog(userId, limit, before);
    }
  );

  // GET /v1/users/:userId/activity  — team-facing activity for a teammate's profile
  app.get(
    "/users/:userId/activity",
    {
      onRequest: [requireAuth],
      schema: {
        tags: ["Activity"],
        summary: "Get activity log for a specific user (teammates only)",
        description:
          "Returns a cursor-paginated activity feed for a given user. The viewer must share at least one non-personal team with the target, or be viewing their own log.",
        params: {
          type: "object",
          required: ["userId"],
          properties: { userId: { type: "string" } },
        },
        querystring: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
            before: { type: "string", description: "ISO 8601 cursor" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              events: { type: "array", items: activityEventShape },
              nextCursor: { type: "string", nullable: true },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (req, reply) => {
      const viewer = (req as any).user as { id: string };
      const { userId: targetId } = req.params as { userId: string };
      const { limit, before } = req.query as { limit?: number; before?: string };

      // Viewing own log is always allowed
      if (viewer.id !== targetId) {
        const sharedTeam = await teamsCollection().findOne({
          members: { $all: [viewer.id, targetId] },
          isPersonal: { $ne: true },
        });
        if (!sharedTeam) {
          return reply.status(403).send({ error: "You can only view activity of teammates." });
        }
      }

      return activityService.getLog(targetId, limit, before);
    }
  );
}
