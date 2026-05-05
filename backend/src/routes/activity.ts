import type { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/require-auth.js";
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
}
