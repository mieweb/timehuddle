import { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/require-auth.js";
import { huddleController } from "../controllers/huddle.controller.js";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const attachmentShape = {
  type: "object",
  required: ["mediaId", "type", "url"],
  properties: {
    mediaId: { type: "string" },
    type: { type: "string", enum: ["image", "video", "file"] },
    url: { type: "string" },
    thumbnailUrl: { type: "string" },
    filename: { type: "string" },
  },
};

const huddlePostShape = {
  type: "object",
  properties: {
    id: { type: "string" },
    teamId: { type: "string" },
    userId: { type: "string" },
    userName: { type: "string" },
    userInitials: { type: "string" },
    content: {
      type: "object",
      properties: {
        text: { type: "string" },
        mentions: { type: "array", items: { type: "string" } },
      },
    },
    ticketId: { type: "string" },
    ticketTitle: { type: "string" },
    attachments: { type: "array", items: attachmentShape },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
  },
};

const idParam = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", pattern: "^[0-9a-f]{24}$" } },
};

const err = (description: string) => ({
  type: "object",
  properties: { error: { type: "string", example: description } },
});

const unauth = { 401: err("Unauthorized") };

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function huddleRoutes(app: FastifyInstance) {
  // GET /v1/huddle/posts?teamId=
  app.get(
    "/huddle/posts",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Huddle"],
        summary: "List huddle posts for a team (team members only)",
        querystring: {
          type: "object",
          required: ["teamId"],
          properties: { teamId: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            properties: { posts: { type: "array", items: huddlePostShape } },
          },
          ...unauth,
          400: err("teamId query parameter required"),
          403: err("Not a team member"),
        },
      },
    },
    huddleController.listForTeam
  );

  // GET /v1/huddle/tickets/:ticketId/posts
  app.get(
    "/huddle/tickets/:ticketId/posts",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Huddle"],
        summary: "List huddle posts for a specific ticket (team members only)",
        params: {
          type: "object",
          required: ["ticketId"],
          properties: { ticketId: { type: "string", pattern: "^[0-9a-f]{24}$" } },
        },
        response: {
          200: {
            type: "object",
            properties: { posts: { type: "array", items: huddlePostShape } },
          },
          ...unauth,
          403: err("Not a team member"),
          404: err("Ticket not found"),
        },
      },
    },
    huddleController.listForTicket
  );

  // POST /v1/huddle/posts
  app.post(
    "/huddle/posts",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Huddle"],
        summary: "Create a huddle post (team members only)",
        body: {
          type: "object",
          required: ["teamId", "content"],
          additionalProperties: false,
          properties: {
            teamId: { type: "string" },
            content: {
              type: "object",
              required: ["text", "mentions"],
              properties: {
                text: { type: "string", minLength: 0, maxLength: 10000 },
                mentions: { type: "array", items: { type: "string" } },
              },
            },
            ticketId: { type: "string" },
            attachments: { type: "array", items: attachmentShape },
          },
        },
        response: {
          201: { type: "object", properties: { id: { type: "string" } } },
          ...unauth,
          400: err("Invalid ticket ID or mentioned users not found"),
          403: err("Not a team member"),
        },
      },
    },
    async (req, reply) => {
      const result = await huddleController.create(req, reply);
      if (result && "id" in result) {
        return reply.status(201).send(result);
      }
      return result;
    }
  );

  // PATCH /v1/huddle/posts/:id
  app.patch(
    "/huddle/posts/:id",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Huddle"],
        summary: "Update a huddle post (author, team admin, or org owner only)",
        params: idParam,
        body: {
          type: "object",
          required: ["content"],
          additionalProperties: false,
          properties: {
            content: {
              type: "object",
              required: ["text", "mentions"],
              properties: {
                text: { type: "string", minLength: 0, maxLength: 10000 },
                mentions: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
        response: {
          200: { type: "object", properties: { post: huddlePostShape } },
          ...unauth,
          400: err("Invalid mentioned users"),
          403: err("Not authorized"),
          404: err("Huddle post not found"),
        },
      },
    },
    huddleController.update
  );

  // DELETE /v1/huddle/posts/:id
  app.delete(
    "/huddle/posts/:id",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Huddle"],
        summary: "Delete a huddle post (author, team admin, or org owner only)",
        params: idParam,
        response: {
          200: { type: "object", properties: { ok: { type: "boolean" } } },
          ...unauth,
          403: err("Not authorized"),
          404: err("Huddle post not found"),
        },
      },
    },
    huddleController.delete
  );

  // POST /v1/huddle/posts/:postId/like — Toggle like
  app.post(
    "/huddle/posts/:postId/like",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Huddle"],
        summary: "Toggle like on a huddle post (team members only)",
        params: {
          type: "object",
          required: ["postId"],
          properties: { postId: { type: "string", pattern: "^[0-9a-f]{24}$" } },
        },
        response: {
          200: { type: "object", properties: { count: { type: "number" } } },
          ...unauth,
          403: err("Not authorized"),
          404: err("Huddle post not found"),
        },
      },
    },
    huddleController.toggleLike
  );

  // GET /v1/huddle/posts/:postId/comments — Get all comments
  app.get(
    "/huddle/posts/:postId/comments",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Huddle"],
        summary: "Get comments for a huddle post (team members only)",
        params: {
          type: "object",
          required: ["postId"],
          properties: { postId: { type: "string", pattern: "^[0-9a-f]{24}$" } },
        },
        response: {
          200: {
            type: "object",
            properties: {
              comments: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    postId: { type: "string" },
                    userId: { type: "string" },
                    userName: { type: "string" },
                    userInitials: { type: "string" },
                    userAvatarUrl: { type: "string" },
                    content: { type: "string" },
                    mentions: { type: "array", items: { type: "string" } },
                    createdAt: { type: "string" },
                    updatedAt: { type: "string" },
                  },
                },
              },
            },
          },
          ...unauth,
          403: err("Not authorized"),
          404: err("Huddle post not found"),
        },
      },
    },
    huddleController.getComments
  );

  // POST /v1/huddle/posts/:postId/comments — Add a comment
  app.post(
    "/huddle/posts/:postId/comments",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Huddle"],
        summary: "Add a comment to a huddle post (team members only)",
        params: {
          type: "object",
          required: ["postId"],
          properties: { postId: { type: "string", pattern: "^[0-9a-f]{24}$" } },
        },
        body: {
          type: "object",
          required: ["content"],
          properties: {
            content: { type: "string", minLength: 1, maxLength: 5000 },
            mentions: { type: "array", items: { type: "string" } },
          },
        },
        response: {
          201: { type: "object", properties: { id: { type: "string" } } },
          ...unauth,
          400: err("Invalid mentioned users"),
          403: err("Not authorized"),
          404: err("Huddle post not found"),
        },
      },
    },
    async (req, reply) => {
      const result = await huddleController.addComment(req, reply);
      if (result && "id" in result) {
        return reply.status(201).send(result);
      }
      return result;
    }
  );

  // DELETE /v1/huddle/comments/:commentId — Delete a comment
  app.delete(
    "/huddle/comments/:commentId",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Huddle"],
        summary: "Delete a comment (author, team admin, or org owner only)",
        params: {
          type: "object",
          required: ["commentId"],
          properties: { commentId: { type: "string", pattern: "^[0-9a-f]{24}$" } },
        },
        response: {
          200: { type: "object", properties: { ok: { type: "boolean" } } },
          ...unauth,
          403: err("Not authorized"),
          404: err("Comment not found"),
        },
      },
    },
    huddleController.deleteComment
  );
}
