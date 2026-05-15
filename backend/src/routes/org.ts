import { ObjectId } from "mongodb";
import { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/require-auth.js";
import { organizationsCollection, usersCollection } from "../models/index.js";
import { DEFAULT_ORG_KEY } from "../lib/org-config.js";

const unauthorizedResponse = {
  401: {
    type: "object",
    properties: { error: { type: "string", example: "Unauthorized" } },
  },
};

export async function orgRoutes(app: FastifyInstance) {
  async function resolveDefaultOrganizationMembership(userId: string): Promise<{
    organizationId: string;
    organizationKey: string;
    role: "owner" | "admin";
  } | null> {
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

  app.put(
    "/org/users/:userId",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Organization"],
        summary: "Update user details in the default organization (owner/admin only)",
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
          additionalProperties: false,
          properties: {
            reportsToUserId: {
              anyOf: [{ type: "string", pattern: "^[0-9a-f]{24}$" }, { type: "null" }],
            },
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
                  reportsToUserId: { type: ["string", "null"] },
                },
              },
            },
          },
          ...unauthorizedResponse,
          400: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string", example: "Forbidden" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (req, reply) => {
      const { userId } = req.params as { userId: string };
      const { reportsToUserId } = req.body as { reportsToUserId?: string | null };

      const requesterMembership = await resolveDefaultOrganizationMembership(req.user!.id);
      if (!requesterMembership || !["owner", "admin"].includes(requesterMembership.role)) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      const user = await usersCollection().findOne({ _id: new ObjectId(userId) });
      if (!user) {
        return reply.status(404).send({ error: "User not found" });
      }

      await usersCollection().updateOne(
        { _id: new ObjectId(userId) },
        { $set: { reportsToUserId, updatedAt: new Date() } }
      );

      return reply.send({
        user: {
          id: userId,
          reportsToUserId,
        },
      });
    }
  );
}
