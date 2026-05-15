import { ObjectId } from "mongodb";
import { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/require-auth.js";
import { organizationsCollection, usersCollection, teamsCollection } from "../models/index.js";
import { DEFAULT_ORG_KEY } from "../lib/org-config.js";
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
    organizationMembership: {
      type: ["object", "null"],
      properties: {
        organizationId: { type: "string" },
        organizationKey: { type: "string" },
        role: { type: "string", enum: ["owner", "admin"] },
      },
    },
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
    reportsToUserId: { type: "string", nullable: true },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

const publicReportsToSchema = {
  type: ["object", "null"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    username: { type: "string", nullable: true },
  },
};

const publicTeamMembershipSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    role: { type: "string", enum: ["admin", "member"] },
  },
};

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function userRoutes(app: FastifyInstance) {
  type DefaultOrganizationRole = "owner" | "admin" | "member";

  async function resolveDefaultOrganizationMembership(userId: string): Promise<
    | {
        organizationId: string;
        organizationKey: string;
        role: "owner" | "admin";
      }
    | null
  > {
    const defaultOrg = await organizationsCollection().findOne({ key: DEFAULT_ORG_KEY });
    if (!defaultOrg) return null;

    const owners = defaultOrg.owners ?? [];
    if (owners.includes(userId)) {
      return {
        organizationId: defaultOrg._id.toHexString(),
        organizationKey: defaultOrg.key,
        role: "owner",
      };
    }

    const admins = defaultOrg.admins ?? [];
    if (admins.includes(userId)) {
      return {
        organizationId: defaultOrg._id.toHexString(),
        organizationKey: defaultOrg.key,
        role: "admin",
      };
    }

    return null;
  }

  function resolveDefaultOrganizationRole(
    owners: string[],
    admins: string[],
    userId: string
  ): DefaultOrganizationRole {
    if (owners.includes(userId)) return "owner";
    if (admins.includes(userId)) return "admin";
    return "member";
  }

  app.get(
    "/admin/organization",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Users"],
        summary: "Get default organization admin metadata (owner/admin only)",
        security: [{ cookieAuth: [] }],
        response: {
          200: {
            type: "object",
            properties: {
              organization: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  key: { type: "string" },
                  name: { type: "string" },
                  ownersCount: { type: "number" },
                  adminsCount: { type: "number" },
                },
              },
            },
          },
          ...unauthorizedResponse,
          403: {
            type: "object",
            properties: { error: { type: "string", example: "Forbidden" } },
          },
          404: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (req, reply) => {
      const requesterMembership = await resolveDefaultOrganizationMembership(req.user!.id);
      if (!requesterMembership) return reply.status(403).send({ error: "Forbidden" });

      const defaultOrg = await organizationsCollection().findOne({ key: DEFAULT_ORG_KEY });
      if (!defaultOrg) return reply.status(404).send({ error: "Default organization not found" });

      return reply.send({
        organization: {
          id: defaultOrg._id.toHexString(),
          key: defaultOrg.key,
          name: defaultOrg.name,
          ownersCount: (defaultOrg.owners ?? []).length,
          adminsCount: (defaultOrg.admins ?? []).length,
        },
      });
    }
  );

  app.put(
    "/admin/organization",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Users"],
        summary: "Update default organization name (owner/admin only)",
        security: [{ cookieAuth: [] }],
        body: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 120 },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              organization: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  key: { type: "string" },
                  name: { type: "string" },
                },
              },
            },
          },
          ...unauthorizedResponse,
          400: {
            type: "object",
            properties: { error: { type: "string" } },
          },
          403: {
            type: "object",
            properties: { error: { type: "string", example: "Forbidden" } },
          },
          404: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (req, reply) => {
      const requesterMembership = await resolveDefaultOrganizationMembership(req.user!.id);
      if (!requesterMembership) return reply.status(403).send({ error: "Forbidden" });

      const { name } = req.body as { name: string };
      const nextName = name.trim();
      if (!nextName) return reply.status(400).send({ error: "Organization name is required" });

      const defaultOrg = await organizationsCollection().findOne({ key: DEFAULT_ORG_KEY });
      if (!defaultOrg) return reply.status(404).send({ error: "Default organization not found" });

      await organizationsCollection().updateOne(
        { _id: defaultOrg._id },
        { $set: { name: nextName, updatedAt: new Date() } }
      );

      return reply.send({
        organization: {
          id: defaultOrg._id.toHexString(),
          key: defaultOrg.key,
          name: nextName,
        },
      });
    }
  );

  app.get(
    "/admin/organization/users",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Users"],
        summary: "List users with default organization role (owner/admin only)",
        security: [{ cookieAuth: [] }],
        response: {
          200: {
            type: "object",
            properties: {
              users: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    name: { type: "string" },
                    email: { type: "string", format: "email" },
                    username: { type: "string", nullable: true },
                    image: { type: "string", nullable: true },
                    role: { type: "string", enum: ["owner", "admin", "member"] },
                  },
                },
              },
            },
          },
          ...unauthorizedResponse,
          403: {
            type: "object",
            properties: { error: { type: "string", example: "Forbidden" } },
          },
        },
      },
    },
    async (req, reply) => {
      const requesterMembership = await resolveDefaultOrganizationMembership(req.user!.id);
      if (!requesterMembership) return reply.status(403).send({ error: "Forbidden" });

      const defaultOrg = await organizationsCollection().findOne({ key: DEFAULT_ORG_KEY });
      const owners = defaultOrg?.owners ?? [];
      const admins = defaultOrg?.admins ?? [];

      const users = await usersCollection()
        .find({}, { projection: { name: 1, email: 1, username: 1, image: 1 } })
        .sort({ name: 1, email: 1 })
        .limit(500)
        .toArray();

      return reply.send({
        users: users.map((u) => ({
          id: u._id.toHexString(),
          name: u.name,
          email: u.email,
          username: u.username ?? null,
          image: u.image ?? null,
          role: resolveDefaultOrganizationRole(owners, admins, u._id.toHexString()),
        })),
      });
    }
  );

  app.put(
    "/admin/organization/users/:userId/role",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Users"],
        summary: "Set default organization role for a user (owner/admin only)",
        security: [{ cookieAuth: [] }],
        params: {
          type: "object",
          required: ["userId"],
          properties: {
            userId: { type: "string", pattern: "^[0-9a-f]{24}$" },
          },
        },
        body: {
          type: "object",
          required: ["role"],
          properties: {
            role: { type: "string", enum: ["owner", "admin", "member"] },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              user: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  role: { type: "string", enum: ["owner", "admin", "member"] },
                },
              },
            },
          },
          ...unauthorizedResponse,
          400: {
            type: "object",
            properties: { error: { type: "string" } },
          },
          403: {
            type: "object",
            properties: { error: { type: "string", example: "Forbidden" } },
          },
          404: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (req, reply) => {
      const requesterMembership = await resolveDefaultOrganizationMembership(req.user!.id);
      if (!requesterMembership) return reply.status(403).send({ error: "Forbidden" });

      const { userId } = req.params as { userId: string };
      const { role } = req.body as { role: DefaultOrganizationRole };

      const [targetUser, defaultOrg] = await Promise.all([
        usersCollection().findOne({ _id: new ObjectId(userId) }),
        organizationsCollection().findOne({ key: DEFAULT_ORG_KEY }),
      ]);

      if (!targetUser) return reply.status(404).send({ error: "User not found" });
      if (!defaultOrg) return reply.status(404).send({ error: "Default organization not found" });

      const owners = new Set(defaultOrg.owners ?? []);
      const admins = new Set(defaultOrg.admins ?? []);

      owners.delete(userId);
      admins.delete(userId);
      if (role === "owner") owners.add(userId);
      if (role === "admin") admins.add(userId);

      const elevatedCount = new Set<string>([...owners, ...admins]).size;
      if (elevatedCount === 0) {
        return reply.status(400).send({ error: "At least one owner or admin is required" });
      }

      await organizationsCollection().updateOne(
        { _id: defaultOrg._id },
        {
          $set: {
            owners: Array.from(owners),
            admins: Array.from(admins),
            updatedAt: new Date(),
          },
        }
      );

      return reply.send({ user: { id: userId, role } });
    }
  );

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
      const [dbUser, organizationMembership] = await Promise.all([
        usersCollection().findOne({ _id: new ObjectId(sessionUser.id) }),
        resolveDefaultOrganizationMembership(sessionUser.id),
      ]);
      return reply.send({
        user: {
          ...sessionUser,
          username: dbUser?.username ?? null,
          organizationMembership,
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
      reportsTo: publicReportsToSchema,
      teamMemberships: {
        type: "array",
        items: publicTeamMembershipSchema,
      },
      sharedTeams: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            isAdmin: { type: "boolean" },
          },
        },
      },
    },
  };

  async function resolveReportsTo(u: Awaited<ReturnType<typeof userService.findById>>) {
    if (!u?.reportsToUserId) return null;
    const reportsToUser = await userService.findById(u.reportsToUserId);
    if (!reportsToUser) return null;
    return {
      id: reportsToUser._id.toHexString(),
      name: reportsToUser.name,
      username: reportsToUser.username ?? null,
    };
  }

  async function resolveTeamMemberships(userId: string) {
    const teamDocs = await teamsCollection()
      .find({ members: userId, isPersonal: { $ne: true } })
      .toArray();

    return teamDocs
      .map((team) => ({
        id: team._id.toString(),
        name: team.name,
        role: team.admins.includes(userId) ? "admin" : "member",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Maps a DB user doc to a safe public payload. */
  async function toPublicUser(u: Awaited<ReturnType<typeof userService.findById>>) {
    if (!u) return null;
    return {
      id: u._id.toHexString(),
      name: u.name,
      username: u.username ?? null,
      image: u.image ?? null,
      bio: u.bio ?? "",
      website: u.website ?? "",
      reportsTo: await resolveReportsTo(u),
      teamMemberships: await resolveTeamMemberships(u._id.toHexString()),
    };
  }

  // ─── Profile lookup by username ───────────────────────────────────────────────

  app.get(
    "/users/by/username/:username",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Users"],
        summary: "Get public profile by username",
        security: [{ cookieAuth: [] }],
        params: {
          type: "object",
          required: ["username"],
          properties: { username: { type: "string" } },
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
      const { username } = req.params as { username: string };
      const user = await userService.findByUsername(username);
      if (!user) return reply.status(404).send({ error: "Not found" });

      const targetId = user._id.toHexString();

      const sharedTeamDocs =
        req.user!.id !== targetId
          ? await teamsCollection()
              .find({
                members: { $all: [req.user!.id, targetId] },
                isPersonal: { $ne: true },
              })
              .toArray()
          : [];

      const sharedTeams = sharedTeamDocs.map((t) => ({
        id: t._id.toString(),
        name: t.name,
        isAdmin: t.admins.includes(targetId),
      }));

      return reply.send({ user: { ...(await toPublicUser(user)), sharedTeams } });
    }
  );

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
      const { id: targetId } = req.params as { id: string };

      const user = await userService.findById(targetId);
      if (!user) return reply.status(404).send({ error: "Not found" });

      // Resolve shared teams (non-personal) between viewer and target
      const sharedTeamDocs =
        req.user!.id === targetId
          ? []
          : await teamsCollection()
              .find({
                members: { $all: [req.user!.id, targetId] },
                isPersonal: { $ne: true },
              })
              .toArray();

      const sharedTeams = sharedTeamDocs.map((t) => ({
        id: t._id.toString(),
        name: t.name,
        isAdmin: t.admins.includes(targetId),
      }));

      return reply.send({ user: { ...(await toPublicUser(user)), sharedTeams } });
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
      return reply.send({ users: await Promise.all(users.map((user) => toPublicUser(user))) });
    }
  );

  // ─── Profile update ──────────────────────────────────────────────────────────

  interface ProfileUpdateBody {
    name?: string;
    image?: string | null;
    bio?: string;
    website?: string;
    reportsToUserId?: string | null;
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
            reportsToUserId: {
              anyOf: [{ type: "string", pattern: "^[0-9a-f]{24}$" }, { type: "null" }],
            },
          },
        },
        response: {
          200: { type: "object", properties: { user: publicUserSchema } },
          400: { type: "object", properties: { error: { type: "string" } } },
          ...unauthorizedResponse,
        },
      },
    },
    async (req, reply) => {
      const body = req.body as ProfileUpdateBody;
      const updated = await userService.updateProfile(req.user!.id, body);
      if (typeof updated === "string") {
        return reply.status(400).send({ error: updated });
      }
      return reply.send({ user: await toPublicUser(updated) });
    }
  );
}
