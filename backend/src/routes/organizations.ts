import type { FastifyInstance } from "fastify";
import { orgController } from "../controllers/org.controller.js";
import { requireAuth } from "../middleware/require-auth.js";

export async function organizationsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get(
    "/organizations",
    {
      schema: {
        tags: ["Organization"],
        summary: "List organizations for current user",
      },
    },
    orgController.list
  );

  app.get(
    "/organizations/check-slug",
    {
      schema: {
        tags: ["Organization"],
        summary: "Check if an organization slug is available",
        querystring: {
          type: "object",
          required: ["slug"],
          properties: {
            slug: { type: "string", minLength: 1, maxLength: 120 },
            excludeId: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: { available: { type: "boolean" } },
          },
        },
      },
    },
    orgController.checkSlug
  );

  app.patch(
    "/organizations/:id",
    {
      schema: {
        tags: ["Organization"],
        summary: "Update organization name, slug, or settings",
        params: { type: "object", properties: { id: { type: "string" } } },
        body: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 1, maxLength: 120 },
            slug: { type: "string", minLength: 1, maxLength: 120 },
            allowAutoJoin: { type: "boolean" },
          },
        },
      },
    },
    orgController.update
  );

  app.post(
    "/organizations",
    {
      schema: {
        tags: ["Organization"],
        summary: "Create organization under an enterprise",
        body: {
          type: "object",
          required: ["enterpriseId", "name"],
          properties: {
            enterpriseId: { type: "string", pattern: "^[0-9a-f]{24}$" },
            name: { type: "string", minLength: 1, maxLength: 120 },
            slug: { type: "string", minLength: 1, maxLength: 120 },
            allowAutoJoin: { type: "boolean" },
          },
        },
      },
    },
    orgController.create
  );

  app.get(
    "/organizations/:id",
    {
      schema: {
        tags: ["Organization"],
        summary: "Get organization details",
        params: { type: "object", properties: { id: { type: "string" } } },
      },
    },
    orgController.get
  );

  app.put(
    "/organizations/:id/settings",
    {
      schema: {
        tags: ["Organization"],
        summary: "Update organization settings",
        params: { type: "object", properties: { id: { type: "string" } } },
        body: {
          type: "object",
          required: ["allowAutoJoin"],
          properties: { allowAutoJoin: { type: "boolean" } },
        },
      },
    },
    orgController.setAllowAutoJoin
  );

  app.post(
    "/organizations/:id/join",
    {
      schema: {
        tags: ["Organization"],
        summary: "Join an organization when auto-join is enabled",
        params: { type: "object", properties: { id: { type: "string" } } },
      },
    },
    orgController.join
  );

  app.get(
    "/organizations/:id/members",
    {
      schema: {
        tags: ["Organization"],
        summary: "List organization members",
        params: { type: "object", properties: { id: { type: "string" } } },
      },
    },
    orgController.listMembers
  );

  app.get(
    "/organizations/:id/users",
    {
      schema: {
        tags: ["Organization"],
        summary: "List organization users for the chart",
        params: { type: "object", properties: { id: { type: "string" } } },
      },
    },
    orgController.listOrganizationUsers
  );

  app.get(
    "/organizations/:id/users/search",
    {
      schema: {
        tags: ["Organization"],
        summary: "Search users available to add to an organization",
        params: { type: "object", properties: { id: { type: "string" } } },
        querystring: { type: "object", properties: { q: { type: "string" } } },
      },
    },
    orgController.searchUsers
  );

  app.put(
    "/organizations/:id/members/:userId/role",
    {
      schema: {
        tags: ["Organization"],
        summary: "Set organization member role",
        params: {
          type: "object",
          properties: { id: { type: "string" }, userId: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["role"],
          properties: { role: { type: "string", enum: ["owner", "admin", "member"] } },
        },
      },
    },
    orgController.setMemberRole
  );

  app.delete(
    "/organizations/:id/members/:userId",
    {
      schema: {
        tags: ["Organization"],
        summary: "Remove organization member",
        params: {
          type: "object",
          properties: { id: { type: "string" }, userId: { type: "string" } },
        },
      },
    },
    orgController.removeMember
  );

  app.post(
    "/organizations/:id/members/:userId/block",
    {
      schema: {
        tags: ["Organization"],
        summary: "Block member from organization (removes from all teams, prevents access)",
        params: {
          type: "object",
          properties: { id: { type: "string" }, userId: { type: "string" } },
        },
        body: {
          type: "object",
          properties: {
            reason: { type: "string", maxLength: 500 },
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
                  blocked: {
                    type: "object",
                    properties: {
                      orgId: { type: "string" },
                      blockedBy: { type: "string" },
                      blockedAt: { type: "string", format: "date-time" },
                      reason: { type: "string" },
                    },
                  },
                },
              },
            },
          },
          403: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
          409: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    orgController.blockMember
  );

  app.delete(
    "/organizations/:id/members/:userId/block",
    {
      schema: {
        tags: ["Organization"],
        summary: "Unblock member from organization (does not restore team memberships)",
        params: {
          type: "object",
          properties: { id: { type: "string" }, userId: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            properties: {
              user: {
                type: "object",
                properties: {
                  id: { type: "string" },
                },
              },
            },
          },
          403: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    orgController.unblockMember
  );

  app.put(
    "/organizations/:id/members/:userId/reports-to",
    {
      schema: {
        tags: ["Organization"],
        summary: "Update organization member reports-to",
        params: {
          type: "object",
          properties: { id: { type: "string" }, userId: { type: "string" } },
        },
        body: {
          type: "object",
          properties: {
            reportsToUserId: {
              anyOf: [{ type: "string", pattern: "^[0-9a-f]{24}$" }, { type: "null" }],
            },
          },
        },
      },
    },
    orgController.updateMemberReportsTo
  );
}
