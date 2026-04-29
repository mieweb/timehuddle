import { FastifyInstance } from "fastify";
import { healthController } from "../controllers/health.controller.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get(
    "/health",
    {
      schema: {
        tags: ["Health"],
        summary: "Health check",
        response: {
          200: {
            type: "object",
            additionalProperties: true,
            properties: {
              status: { type: "string", example: "ok" },
              timestamp: { type: "string", format: "date-time" },
              version: { type: "string" },
            },
          },
        },
      },
    },
    healthController.check
  );
}
