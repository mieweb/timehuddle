import { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/require-auth.js";
import { patService } from "../services/pat.service.js";

export async function tokenRoutes(app: FastifyInstance) {
  // GET /v1/me/tokens — list tokens (no hash)
  app.get(
    "/me/tokens",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Users"],
        summary: "List personal access tokens",
        security: [{ cookieAuth: [] }],
        response: {
          200: {
            type: "object",
            properties: {
              tokens: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    _id: { type: "string" },
                    name: { type: "string" },
                    createdAt: { type: "string", format: "date-time" },
                    lastUsedAt: { type: "string", format: "date-time", nullable: true },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (req) => {
      const tokens = await patService.listTokens(req.user!.id);
      return { tokens };
    }
  );

  // POST /v1/me/tokens — create token, return raw once
  app.post<{ Body: { name: string } }>(
    "/me/tokens",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Users"],
        summary: "Create a personal access token",
        security: [{ cookieAuth: [] }],
        body: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string", minLength: 1, maxLength: 100 } },
        },
        response: {
          201: {
            type: "object",
            properties: {
              token: { type: "string", description: "Raw token — shown only once" },
              name: { type: "string" },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const { name } = req.body;
      const { rawToken } = await patService.createToken(req.user!.id, name);
      return reply.status(201).send({ token: rawToken, name });
    }
  );

  // DELETE /v1/me/tokens/:id — revoke token
  app.delete<{ Params: { id: string } }>(
    "/me/tokens/:id",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Users"],
        summary: "Revoke a personal access token",
        security: [{ cookieAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            properties: { success: { type: "boolean" } },
          },
          404: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (req, reply) => {
      const deleted = await patService.revokeToken(req.user!.id, req.params.id);
      if (!deleted) {
        return reply.status(404).send({ error: "Token not found" });
      }
      return { success: true };
    }
  );
}
