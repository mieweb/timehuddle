import { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/require-auth.js";
import { orgController } from "../controllers/org.controller.js";

const unauthorizedResponse = {
  401: {
    type: "object",
    properties: { error: { type: "string", example: "Unauthorized" } },
  },
};

export async function orgRoutes(app: FastifyInstance) {
  app.put<{ Params: { userId: string }; Body: { reportsToUserId?: string | null } }>(
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
    orgController.updateOrgUserReportsTo
  );
}
