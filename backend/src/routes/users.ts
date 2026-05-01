import { ObjectId } from "mongodb";
import { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/require-auth.js";
import { usersCollection } from "../models/index.js";
import { userService } from "../services/user.service.js";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const unauthorizedResponse = {
  401: {
    type: "object",
    properties: { error: { type: "string", example: "Unauthorized" } },
  },
};

const userSessionSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    email: { type: "string", format: "email" },
    image: { type: "string", nullable: true },
    username: { type: "string", nullable: true },
  },
};

const userProfileSchema = {
  type: "object",
  properties: {
    _id: { type: "string" },
    name: { type: "string" },
    email: { type: "string", format: "email" },
    emailVerified: { type: "boolean" },
    image: { type: "string", nullable: true },
    username: { type: "string", nullable: true },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function userRoutes(app: FastifyInstance) {
  app.get(
    "/me",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Users"],
        summary: "Get current user (from session)",
        security: [{ cookieAuth: [] }],
        response: {
          200: { type: "object", properties: { user: userSessionSchema } },
          ...unauthorizedResponse,
        },
      },
    },
    async (req, reply) => {
      // Augment the session user with the username from the users collection.
      const sessionUser = req.user!;
      const dbUser = await usersCollection().findOne({ _id: new ObjectId(sessionUser.id) });
      return reply.send({
        user: {
          ...sessionUser,
          username: dbUser?.username ?? null,
        },
      });
    }
  );

  app.get(
    "/me/profile",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Users"],
        summary: "Get full user profile from DB",
        security: [{ cookieAuth: [] }],
        response: {
          200: { type: "object", properties: { user: userProfileSchema } },
          ...unauthorizedResponse,
          404: {
            type: "object",
            properties: { error: { type: "string", example: "User not found" } },
          },
        },
      },
    },
    async (req, reply) => {
      const user = await usersCollection().findOne({
        _id: new ObjectId(req.user!.id),
      });
      if (!user) return reply.status(404).send({ error: "User not found" });
      return reply.send({ user });
    }
  );

  // ─── Username availability check ─────────────────────────────────────────────

  app.get(
    "/me/username-available",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Users"],
        summary: "Check whether a username is available",
        security: [{ cookieAuth: [] }],
        querystring: {
          type: "object",
          required: ["username"],
          properties: { username: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            properties: {
              available: { type: "boolean" },
              reason: { type: "string", nullable: true },
            },
          },
          ...unauthorizedResponse,
        },
      },
    },
    async (req, reply) => {
      const { username } = req.query as { username: string };
      const result = await userService.isUsernameAvailable(username.trim().toLowerCase());
      return reply.send({ available: result.available, reason: result.reason ?? null });
    }
  );

  // ─── Username claim ───────────────────────────────────────────────────────────

  app.post(
    "/me/username",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Users"],
        summary: "Claim a canonical username",
        security: [{ cookieAuth: [] }],
        body: {
          type: "object",
          required: ["username"],
          properties: { username: { type: "string", minLength: 3, maxLength: 30 } },
        },
        response: {
          200: {
            type: "object",
            properties: { username: { type: "string" } },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          409: { type: "object", properties: { error: { type: "string" } } },
          ...unauthorizedResponse,
        },
      },
    },
    async (req, reply) => {
      const { username } = req.body as { username: string };
      const result = await userService.claimUsername(req.user!.id, username);

      if (typeof result === "string") {
        // Discriminated error
        if (result === "taken" || result === "already-claimed") {
          return reply.status(409).send({ error: result });
        }
        return reply.status(400).send({ error: result });
      }

      return reply.send({ username: result!.username });
    }
  );

  // ─── Public user lookups (for display names & avatars) ──────────────────────

  const publicUserSchema = {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      username: { type: "string", nullable: true },
      image: { type: "string", nullable: true },
      bio: { type: "string" },
      website: { type: "string" },
    },
  };

  /** Maps a DB user doc to a safe public payload. */
  function toPublicUser(u: Awaited<ReturnType<typeof userService.findById>>) {
    if (!u) return null;
    return {
      id: u._id.toHexString(),
      name: u.name,
      username: u.username ?? null,
      image: u.image ?? null,
      bio: u.bio ?? "",
      website: u.website ?? "",
    };
  }

  app.get(
    "/users/:id",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Users"],
        summary: "Get public profile by user ID",
        security: [{ cookieAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", pattern: "^[0-9a-f]{24}$" } },
        },
        response: {
          200: { type: "object", properties: { user: publicUserSchema } },
          ...unauthorizedResponse,
          404: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const user = await userService.findById(id);
      if (!user) return reply.status(404).send({ error: "Not found" });
      return reply.send({ user: toPublicUser(user) });
    }
  );

  app.get(
    "/users",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Users"],
        summary: "Batch public profile lookup by comma-separated IDs (?ids=)",
        security: [{ cookieAuth: [] }],
        querystring: {
          type: "object",
          properties: { ids: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            properties: { users: { type: "array", items: publicUserSchema } },
          },
          ...unauthorizedResponse,
        },
      },
    },
    async (req, reply) => {
      const { ids } = req.query as { ids?: string };
      if (!ids) return reply.send({ users: [] });
      const rawIds = ids
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const users = await userService.findManyByIds(rawIds);
      return reply.send({ users: users.map(toPublicUser) });
    }
  );

  // ─── Profile update ──────────────────────────────────────────────────────────

  interface ProfileUpdateBody {
    name?: string;
    image?: string | null;
    bio?: string;
    website?: string;
  }

  app.put(
    "/me/profile",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Users"],
        summary: "Update current user's profile",
        security: [{ cookieAuth: [] }],
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 200 },
            image: { type: "string", nullable: true },
            bio: { type: "string", maxLength: 500 },
            website: {
              type: "string",
              maxLength: 200,
              pattern: "^$|^https?:\\/\\/.+",
            },
          },
        },
        response: {
          200: { type: "object", properties: { user: publicUserSchema } },
          ...unauthorizedResponse,
        },
      },
    },
    async (req, reply) => {
      const body = req.body as ProfileUpdateBody;
      const updated = await userService.updateProfile(req.user!.id, body);
      return reply.send({ user: toPublicUser(updated) });
    }
  );
}
