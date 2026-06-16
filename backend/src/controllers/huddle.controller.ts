import type { FastifyReply, FastifyRequest } from "fastify";
import { huddleService } from "../services/huddle.service.js";
import type { HuddlePost, PublicHuddlePost } from "../models/huddle-post.model.js";

function toPublicHuddlePost(post: HuddlePost): PublicHuddlePost {
  return {
    id: post._id.toHexString(),
    teamId: post.teamId,
    userId: post.userId,
    content: post.content,
    ticketId: post.ticketId,
    attachments: post.attachments,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}

export const huddleController = {
  async create(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const { teamId, content, ticketId, attachments } = req.body as {
      teamId: string;
      content: {
        text: string;
        mentions: string[];
      };
      ticketId?: string;
      attachments: Array<{
        mediaId: string;
        type: "image" | "video" | "file";
        url: string;
        thumbnailUrl?: string;
        filename?: string;
      }>;
    };

    const result = await huddleService.createPost({
      teamId,
      userId,
      content,
      ticketId,
      attachments: attachments ?? [],
    });

    if (result === "forbidden") {
      return reply.status(403).send({ error: "Forbidden" });
    }
    if (result === "invalid-ticket") {
      return reply.status(400).send({ error: "Invalid ticket ID or ticket not in team" });
    }
    if (result === "invalid-mentions") {
      return reply.status(400).send({ error: "One or more mentioned users not found" });
    }

    // Type guard: at this point, result must be { id: string }
    if (typeof result === "string") {
      return reply.status(500).send({ error: "Unexpected error" });
    }

    return { id: result.id };
  },

  async listForTeam(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const { teamId } = req.query as { teamId: string };

    if (!teamId) {
      return reply.status(400).send({ error: "teamId query parameter required" });
    }

    const result = await huddleService.findByTeam(teamId, userId);

    if (result === "forbidden") {
      return reply.status(403).send({ error: "Forbidden" });
    }
    if (result === "not-found") {
      return reply.status(404).send({ error: "Team not found" });
    }
    if (result === "invalid-ticket" || result === "invalid-mentions") {
      return reply.status(500).send({ error: "Unexpected error" });
    }

    return { posts: result.map(toPublicHuddlePost) };
  },

  async delete(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const { id } = req.params as { id: string };

    const result = await huddleService.deletePost(id, userId);

    if (result === "not-found") {
      return reply.status(404).send({ error: "Huddle post not found" });
    }
    if (result === "forbidden") {
      return reply.status(403).send({ error: "Forbidden" });
    }

    return { ok: true };
  },
};
