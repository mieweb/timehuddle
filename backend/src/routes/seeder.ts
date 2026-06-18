import type { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/require-auth.js";
import { importSeedYaml, tryParseSeedYaml } from "../services/seeder.service.js";
import { orgService } from "../services/org.service.js";

const unauthorizedResponse = {
  401: {
    type: "object",
    properties: { error: { type: "string", example: "Unauthorized" } },
  },
};

export async function seedImportRoutes(app: FastifyInstance) {
  if (process.env.NODE_ENV === "production") return;

  app.post(
    "/seed/import/parse",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Users"],
        summary: "Parse a dev seed YAML document",
        security: [{ cookieAuth: [] }],
        body: {
          type: "object",
          required: ["yaml"],
          properties: { yaml: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      const { yaml } = req.body as { yaml: string };
      return reply.send(tryParseSeedYaml(yaml));
    }
  );

  app.post(
    "/seed/import",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Users"],
        summary: "Import dev seed YAML",
        security: [{ cookieAuth: [] }],
        body: {
          type: "object",
          required: ["yaml"],
          properties: {
            yaml: { type: "string" },
            orgId: { type: "string", description: "Organization ID to add top-level teams to" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              created: {
                type: "object",
                properties: {
                  enterprises: { type: "number" },
                  organizations: { type: "number" },
                  teams: { type: "number" },
                  users: { type: "number" },
                  tickets: { type: "number" },
                },
              },
              updated: {
                type: "object",
                properties: {
                  enterprises: { type: "number" },
                  organizations: { type: "number" },
                  teams: { type: "number" },
                  users: { type: "number" },
                },
              },
              summary: { type: "string" },
            },
          },
          ...unauthorizedResponse,
          400: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (req, reply) => {
      const { yaml, orgId } = req.body as { yaml: string; orgId?: string };
      try {
        const defaultEnterprise = await orgService.ensureDefaultEnterprise();
        const result = await importSeedYaml(yaml, {
          defaultEnterpriseId: defaultEnterprise._id.toHexString(),
          orgId,
        });
        return reply.send({
          ...result,
          summary: `Created: ${result.created.users} users, ${result.created.organizations} orgs, ${result.created.teams} teams, ${result.created.tickets} tickets`,
        });
      } catch (error) {
        return reply.status(400).send({
          error: error instanceof Error ? error.message : "Failed to import seed YAML",
        });
      }
    }
  );
}
