import type { FastifyReply, FastifyRequest } from "fastify";
import { ObjectId } from "mongodb";
import { huddleService } from "../services/huddle.service.js";
import { usersCollection, ticketsCollection } from "../models/index.js";
import type { HuddlePost, PublicHuddlePost } from "../models/huddle-post.model.js";

function getUserInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "??"; // Defensive: never return empty string
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return trimmed.substring(0, 2).toUpperCase();
}

async function toPublicHuddlePost(post: HuddlePost): Promise<PublicHuddlePost> {
  // Fetch user data
  const user = await usersCollection().findOne({ _id: new ObjectId(post.userId) });
  const userName = user?.name || "Unknown User";
  const userInitials = getUserInitials(userName);

  // Fetch ticket title if ticketId exists
  let ticketTitle: string | undefined;
  if (post.ticketId) {
    const ticket = await ticketsCollection().findOne({ _id: new ObjectId(post.ticketId) });
    ticketTitle = ticket?.title;
  }

  return {
    id: post._id.toHexString(),
    teamId: post.teamId,
    userId: post.userId,
    userName,
    userInitials,
    content: post.content,
    ticketId: post.ticketId,
    ticketTitle,
    attachments: post.attachments,
    likes: post.likes ?? [],
    commentCount: post.commentCount ?? 0,
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

    const posts = await Promise.all(result.map(toPublicHuddlePost));
    return { posts };
  },

  async listForTicket(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const { ticketId } = req.params as { ticketId: string };

    const result = await huddleService.findByTicket(ticketId, userId);

    if (result === "not-found") {
      return reply.status(404).send({ error: "Ticket not found" });
    }
    if (result === "forbidden") {
      return reply.status(403).send({ error: "Forbidden" });
    }
    if (result === "invalid-ticket" || result === "invalid-mentions") {
      return reply.status(500).send({ error: "Unexpected error" });
    }

    const posts = await Promise.all(result.map(toPublicHuddlePost));
    return { posts };
  },

  async update(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const { id } = req.params as { id: string };
    const { content } = req.body as {
      content: {
        text: string;
        mentions: string[];
      };
    };

    const result = await huddleService.updatePost(id, userId, content);

    if (result === "not-found") {
      return reply.status(404).send({ error: "Huddle post not found" });
    }
    if (result === "forbidden") {
      return reply.status(403).send({ error: "Forbidden" });
    }
    if (result === "invalid-mentions") {
      return reply.status(400).send({ error: "One or more mentioned users not found" });
    }

    // Type guard
    if (typeof result === "string") {
      return reply.status(500).send({ error: "Unexpected error" });
    }

    const post = await toPublicHuddlePost(result.post);
    return { post };
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

  async toggleLike(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const { postId } = req.params as { postId: string };

    const result = await huddleService.toggleLike(postId, userId);

    if (result === "not-found") {
      return reply.status(404).send({ error: "Huddle post not found" });
    }
    if (result === "forbidden") {
      return reply.status(403).send({ error: "Forbidden" });
    }

    // Type guard
    if (typeof result === "string") {
      return reply.status(500).send({ error: "Unexpected error" });
    }

    return { count: result.count };
  },

  async addComment(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const { postId } = req.params as { postId: string };
    const { content, mentions } = req.body as {
      content: string;
      mentions: string[];
    };

    const result = await huddleService.addComment({
      postId,
      userId,
      content,
      mentions: mentions ?? [],
    });

    if (result === "not-found") {
      return reply.status(404).send({ error: "Huddle post not found" });
    }
    if (result === "forbidden") {
      return reply.status(403).send({ error: "Forbidden" });
    }
    if (result === "invalid-mentions") {
      return reply.status(400).send({ error: "One or more mentioned users not found" });
    }

    // Type guard
    if (typeof result === "string") {
      return reply.status(500).send({ error: "Unexpected error" });
    }

    return { id: result.id };
  },

  async getComments(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const { postId } = req.params as { postId: string };

    const result = await huddleService.getComments(postId, userId);

    if (result === "not-found") {
      return reply.status(404).send({ error: "Huddle post not found" });
    }
    if (result === "forbidden") {
      return reply.status(403).send({ error: "Forbidden" });
    }

    // Type guard
    if (typeof result === "string") {
      return reply.status(500).send({ error: "Unexpected error" });
    }

    return { comments: result };
  },

  async deleteComment(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const { commentId } = req.params as { commentId: string };

    const result = await huddleService.deleteComment(commentId, userId);

    if (result === "not-found") {
      return reply.status(404).send({ error: "Comment not found" });
    }
    if (result === "forbidden") {
      return reply.status(403).send({ error: "Forbidden" });
    }

    return { ok: true };
  },
};
