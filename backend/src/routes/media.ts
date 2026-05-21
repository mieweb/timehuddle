import type { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/require-auth.js";
import { mediaService } from "../services/media.service.js";

const mediaItemShape = {
  type: "object",
  properties: {
    id: { type: "string" },
    userId: { type: "string" },
    type: { type: "string" },
    mimeType: { type: "string" },
    url: { type: "string" },
    videoid: { type: "string", nullable: true },
    filename: { type: "string" },
    size: { type: "number" },
    title: { type: "string", nullable: true },
    caption: { type: "string", nullable: true },
    altText: { type: "string", nullable: true },
    width: { type: "number", nullable: true },
    height: { type: "number", nullable: true },
    duration: { type: "number", nullable: true },
    thumbnail: { type: "string", nullable: true },
    uploadedAt: { type: "string" },
  },
};

export async function mediaRoutes(app: FastifyInstance) {
  // GET /v1/media?userId=<id> — list media items for a user
  app.get(
    "/media",
    {
      onRequest: [requireAuth],
      schema: {
        tags: ["Media"],
        summary: "List media library items for a user",
        querystring: {
          type: "object",
          required: ["userId"],
          properties: {
            userId: { type: "string" },
            limit: { type: "number", default: 50 },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              items: { type: "array", items: mediaItemShape },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const { userId, limit } = req.query as { userId: string; limit?: number };
      const items = await mediaService.getForUser(userId, limit ?? 50);
      return reply.send({ items });
    }
  );

  // DELETE /v1/media/:id — remove a media item (owner only)
  app.delete(
    "/media/:id",
    {
      onRequest: [requireAuth],
      schema: {
        tags: ["Media"],
        summary: "Delete a media library item",
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string" },
          },
        },
        response: {
          200: { type: "object", properties: { ok: { type: "boolean" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const userId = req.user!.id;
      const result = await mediaService.remove(userId, id);
      if (result === "not-found") return reply.status(404).send({ error: "Not found" });
      if (result === "forbidden") return reply.status(403).send({ error: "Forbidden" });
      return reply.send({ ok: true });
    }
  );
}
