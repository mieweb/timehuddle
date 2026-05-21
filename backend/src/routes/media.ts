import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/require-auth.js";
import { teamsCollection } from "../models/index.js";
import { mediaService } from "../services/media.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const thumbnailsDir = path.resolve(__dirname, "../../uploads/thumbnails");

function buildThumbnailFilename(userId: string): string {
  const hex = randomBytes(8).toString("hex");
  return `${userId}-${hex}.jpg`;
}

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
          properties: {
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
      const { limit } = req.query as { userId?: string; limit?: number };
      const userId = req.user!.id;
      const items = await mediaService.getForUser(userId, limit ?? 50);
      return reply.send({ items });
    }
  );

  // GET /v1/media/user/:userId — list media items for a specific profile user
  app.get(
    "/media/user/:userId",
    {
      onRequest: [requireAuth],
      schema: {
        tags: ["Media"],
        summary: "List media library items for a specific user profile",
        params: {
          type: "object",
          required: ["userId"],
          properties: {
            userId: { type: "string", pattern: "^[0-9a-f]{24}$" },
          },
        },
        querystring: {
          type: "object",
          properties: {
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
          403: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (req, reply) => {
      const { userId } = req.params as { userId: string };
      const { limit } = req.query as { limit?: number };
      const viewerId = req.user!.id;

      if (viewerId !== userId) {
        const sharedTeam = await teamsCollection().findOne({
          members: { $all: [viewerId, userId] },
          isPersonal: { $ne: true },
        });

        if (!sharedTeam) {
          return reply.status(403).send({ error: "Forbidden" });
        }
      }

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

  // PATCH /v1/media/:id — update editable metadata (owner only)
  app.patch(
    "/media/:id",
    {
      onRequest: [requireAuth],
      schema: {
        tags: ["Media"],
        summary: "Update media item metadata",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          properties: {
            title: { type: "string" },
            caption: { type: "string" },
            altText: { type: "string" },
          },
        },
        response: {
          200: { type: "object", properties: { item: mediaItemShape } },
          403: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const userId = req.user!.id;
      const body = req.body as { title?: string; caption?: string; altText?: string };
      const result = await mediaService.update(userId, id, body);
      if (result === "not-found") return reply.status(404).send({ error: "Not found" });
      if (result === "forbidden") return reply.status(403).send({ error: "Forbidden" });
      return reply.send({ item: result });
    }
  );

  // POST /v1/media/:id/thumbnail — upload a JPEG thumbnail (owner only, multipart)
  app.post(
    "/media/:id/thumbnail",
    {
      onRequest: [requireAuth],
      schema: {
        tags: ["Media"],
        summary: "Upload a thumbnail image for a media item",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        response: {
          200: { type: "object", properties: { item: mediaItemShape } },
          400: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const userId = req.user!.id;

      const ownership = await mediaService.ensureOwned(userId, id);
      if (ownership === "not-found") return reply.status(404).send({ error: "Not found" });
      if (ownership === "forbidden") return reply.status(403).send({ error: "Forbidden" });

      const data = await req.file();
      if (!data) return reply.status(400).send({ error: "No file uploaded" });

      const filename = buildThumbnailFilename(userId);
      const dest = path.join(thumbnailsDir, filename);
      await fs.writeFile(dest, await data.toBuffer());

      const thumbnailUrl = `/uploads/thumbnails/${filename}`;

      const result = await mediaService.setThumbnail(userId, id, thumbnailUrl);
      if (result === "not-found") return reply.status(404).send({ error: "Not found" });
      if (result === "forbidden") return reply.status(403).send({ error: "Forbidden" });
      return reply.send({ item: result });
    }
  );
}
