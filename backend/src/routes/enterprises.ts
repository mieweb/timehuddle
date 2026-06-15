import type { FastifyInstance } from "fastify";
import { enterpriseController } from "../controllers/enterprise.controller.js";
import { requireAuth } from "../middleware/require-auth.js";

export async function enterpriseRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get(
    "/enterprises",
    {
      schema: {
        tags: ["Organization"],
        summary: "List enterprises for the current user",
      },
    },
    enterpriseController.list
  );

  app.post(
    "/enterprises",
    {
      schema: {
        tags: ["Organization"],
        summary: "Create an enterprise",
        body: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 120 },
            slug: { type: "string", minLength: 1, maxLength: 64 },
          },
        },
      },
    },
    enterpriseController.create
  );

  app.get(
    "/enterprises/:id",
    {
      schema: {
        tags: ["Organization"],
        summary: "Get enterprise details",
        params: { type: "object", properties: { id: { type: "string" } } },
      },
    },
    enterpriseController.get
  );

  app.get(
    "/enterprises/:id/users/search",
    {
      schema: {
        tags: ["Organization"],
        summary: "Search users to add to an enterprise",
        params: { type: "object", properties: { id: { type: "string" } } },
        querystring: { type: "object", properties: { q: { type: "string" } } },
      },
    },
    enterpriseController.searchUsers
  );

  app.delete(
    "/enterprises/:id/members/:userId",
    {
      schema: {
        tags: ["Organization"],
        summary: "Remove enterprise member",
        params: {
          type: "object",
          properties: { id: { type: "string" }, userId: { type: "string" } },
        },
      },
    },
    enterpriseController.removeMember
  );

  app.put(
    "/enterprises/:id",
    {
      schema: {
        tags: ["Organization"],
        summary: "Update enterprise name",
        params: { type: "object", properties: { id: { type: "string" } } },
        body: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 120 },
          },
        },
      },
    },
    enterpriseController.updateName
  );

  app.put(
    "/enterprises/:id/members/:userId",
    {
      schema: {
        tags: ["Organization"],
        summary: "Set enterprise member role",
        params: {
          type: "object",
          properties: { id: { type: "string" }, userId: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["role"],
          properties: { role: { type: "string", enum: ["owner", "admin"] } },
        },
      },
    },
    enterpriseController.setMemberRole
  );
}
