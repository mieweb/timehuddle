import { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/require-auth.js";
import { attachmentService } from "../services/attachment.service.js";
import { getYouTubeTitleFromUrl, isYouTubeUrl } from "../services/youtube.js";
import type { AttachmentKind, AttachmentType } from "../models/attachment.model.js";

const VALID_KINDS = ["clock", "ticket"] as const;
const VALID_TYPES = ["video", "image", "link"] as const;

const attachmentShape = {
  type: "object",
  properties: {
    id: { type: "string" },
    url: { type: "string" },
    type: { type: "string" },
    title: { type: "string", nullable: true },
    thumbnail: { type: "string", nullable: true },
    attachedTo: {
      type: "object",
      properties: {
        kind: { type: "string" },
        id: { type: "string" },
      },
    },
    addedBy: { type: "string" },
    addedAt: { type: "string" },
  },
};

export async function attachmentRoutes(app: FastifyInstance) {
  // POST /v1/attachments
  app.post(
    "/attachments",
    {
      onRequest: [requireAuth],
      schema: {
        tags: ["Attachments"],
        body: {
          type: "object",
          required: ["url", "type", "attachedTo"],
          properties: {
            url: { type: "string" },
            type: { type: "string", enum: ["video", "image", "link"] },
            title: { type: "string" },
            thumbnail: { type: "string" },
            attachedTo: {
              type: "object",
              required: ["kind", "id"],
              properties: {
                kind: { type: "string", enum: ["clock", "ticket"] },
                id: { type: "string" },
              },
            },
          },
        },
        response: { 201: { type: "object", properties: { attachment: attachmentShape } } },
      },
    },
    async (req, reply) => {
      const { id: userId } = (req as any).user;
      const { url, type, title, thumbnail, attachedTo } = req.body as {
        url: string;
        type: AttachmentType;
        title?: string;
        thumbnail?: string;
        attachedTo: { kind: AttachmentKind; id: string };
      };

      if (!VALID_KINDS.includes(attachedTo.kind)) {
        return reply.status(400).send({ error: "Invalid attachedTo.kind" });
      }
      if (!VALID_TYPES.includes(type)) {
        return reply.status(400).send({ error: "Invalid type" });
      }

      const attachment = await attachmentService.create(userId, url, type, attachedTo, {
        title: title ?? (isYouTubeUrl(url) ? (await getYouTubeTitleFromUrl(url)) ?? undefined : undefined),
        thumbnail,
      });
      return reply.status(201).send({ attachment });
    }
  );

  // GET /v1/attachments?kind=clock&id=<entityId>
  app.get(
    "/attachments",
    {
      onRequest: [requireAuth],
      schema: {
        tags: ["Attachments"],
        querystring: {
          type: "object",
          required: ["kind", "id"],
          properties: {
            kind: { type: "string", enum: ["clock", "ticket"] },
            id: { type: "string" },
          },
        },
        response: {
          200: { type: "object", properties: { attachments: { type: "array", items: attachmentShape } } },
        },
      },
    },
    async (req, reply) => {
      const { kind, id } = req.query as { kind: AttachmentKind; id: string };
      if (!VALID_KINDS.includes(kind)) {
        return reply.status(400).send({ error: "Invalid kind" });
      }
      const attachments = await attachmentService.getForEntity(kind, id);
      return { attachments };
    }
  );

  // DELETE /v1/attachments/:id
  app.delete(
    "/attachments/:id",
    {
      onRequest: [requireAuth],
      schema: {
        tags: ["Attachments"],
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        response: { 200: { type: "object", properties: { ok: { type: "boolean" } } } },
      },
    },
    async (req, reply) => {
      const { id: userId } = (req as any).user;
      const { id: attachmentId } = req.params as { id: string };
      const result = await attachmentService.remove(userId, attachmentId);
      if (result === "not-found") return reply.status(404).send({ error: "Attachment not found" });
      if (result === "forbidden") return reply.status(403).send({ error: "Forbidden" });
      return { ok: true };
    }
  );
}
