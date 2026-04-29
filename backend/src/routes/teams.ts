import type { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/require-auth.js";
import { teamService } from "../services/team.service.js";

// Reusable team shape for Swagger response schemas
const teamShape = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    description: { type: ["string", "null"] },
    members: { type: "array", items: { type: "string" } },
    admins: { type: "array", items: { type: "string" } },
    code: { type: "string" },
    isPersonal: { type: "boolean" },
    createdAt: { type: "string" },
    updatedAt: { type: ["string", "null"] },
  },
};

const memberShape = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    email: { type: "string" },
  },
};

export async function teamRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  // ── GET /v1/teams ─────────────────────────────────────────────────────────

  app.get(
    "/teams",
    {
      schema: {
        tags: ["Teams"],
        summary: "List teams for current user",
        response: {
          200: {
            type: "object",
            properties: { teams: { type: "array", items: teamShape } },
          },
        },
      },
    },
    async (req, reply) => {
      const userId = (req as any).user.id as string;
      const teams = await teamService.getTeamsForUser(userId);
      return reply.send({ teams });
    }
  );

  // ── POST /v1/teams/ensure-personal ────────────────────────────────────────

  app.post(
    "/teams/ensure-personal",
    {
      schema: {
        tags: ["Teams"],
        summary: "Ensure personal workspace exists (idempotent)",
        response: { 200: { type: "object", properties: { team: teamShape } } },
      },
    },
    async (req, reply) => {
      const userId = (req as any).user.id as string;
      const team = await teamService.ensurePersonalWorkspace(userId);
      return reply.send({ team });
    }
  );

  // ── POST /v1/teams/join ───────────────────────────────────────────────────

  app.post(
    "/teams/join",
    {
      schema: {
        tags: ["Teams"],
        summary: "Join a team by code",
        body: {
          type: "object",
          required: ["teamCode"],
          properties: { teamCode: { type: "string" } },
        },
        response: { 200: { type: "object", properties: { team: teamShape } } },
      },
    },
    async (req, reply) => {
      const userId = (req as any).user.id as string;
      const { teamCode } = req.body as { teamCode: string };
      const result = await teamService.joinByCode(userId, teamCode);
      if (result === "not-found") return reply.status(404).send({ error: "Team not found" });
      if (result === "already-member") return reply.status(409).send({ error: "Already a member" });
      return reply.send({ team: result });
    }
  );

  // ── POST /v1/teams ────────────────────────────────────────────────────────

  app.post(
    "/teams",
    {
      schema: {
        tags: ["Teams"],
        summary: "Create a new team",
        body: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 100 },
            description: { type: "string", maxLength: 500 },
          },
        },
        response: { 201: { type: "object", properties: { team: teamShape } } },
      },
    },
    async (req, reply) => {
      const userId = (req as any).user.id as string;
      const { name, description } = req.body as { name: string; description?: string };
      const team = await teamService.createTeam(userId, { name, description });
      return reply.status(201).send({ team });
    }
  );

  // ── PUT /v1/teams/:id/name ─────────────────────────────────────────────────

  app.put(
    "/teams/:id/name",
    {
      schema: {
        tags: ["Teams"],
        summary: "Rename a team (admin only)",
        params: { type: "object", properties: { id: { type: "string" } } },
        body: {
          type: "object",
          required: ["newName"],
          properties: { newName: { type: "string", minLength: 1, maxLength: 100 } },
        },
        response: { 200: { type: "object", properties: { team: teamShape } } },
      },
    },
    async (req, reply) => {
      const userId = (req as any).user.id as string;
      const { id } = req.params as { id: string };
      const { newName } = req.body as { newName: string };
      const result = await teamService.renameTeam(id, userId, newName);
      if (result === "not-found") return reply.status(404).send({ error: "Team not found" });
      if (result === "forbidden") return reply.status(403).send({ error: "Admin only" });
      return reply.send({ team: result });
    }
  );

  // ── DELETE /v1/teams/:id ──────────────────────────────────────────────────

  app.delete(
    "/teams/:id",
    {
      schema: {
        tags: ["Teams"],
        summary: "Delete a team (admin only)",
        params: { type: "object", properties: { id: { type: "string" } } },
        response: { 200: { type: "object", properties: { ok: { type: "boolean" } } } },
      },
    },
    async (req, reply) => {
      const userId = (req as any).user.id as string;
      const { id } = req.params as { id: string };
      const result = await teamService.deleteTeam(id, userId);
      if (result === "not-found") return reply.status(404).send({ error: "Team not found" });
      if (result === "forbidden") return reply.status(403).send({ error: "Admin only" });
      return reply.send({ ok: true });
    }
  );

  // ── GET /v1/teams/:id/members ─────────────────────────────────────────────

  app.get(
    "/teams/:id/members",
    {
      schema: {
        tags: ["Teams"],
        summary: "Get members of a team",
        params: { type: "object", properties: { id: { type: "string" } } },
        response: {
          200: {
            type: "object",
            properties: { members: { type: "array", items: memberShape } },
          },
        },
      },
    },
    async (req, reply) => {
      const userId = (req as any).user.id as string;
      const { id } = req.params as { id: string };
      const result = await teamService.getMembers(id, userId);
      if (result === "not-found") return reply.status(404).send({ error: "Team not found" });
      return reply.send({ members: result });
    }
  );

  // ── POST /v1/teams/:id/invite ─────────────────────────────────────────────

  app.post(
    "/teams/:id/invite",
    {
      schema: {
        tags: ["Teams"],
        summary: "Invite a user to the team by email (adds directly; notifications in Phase 8)",
        params: { type: "object", properties: { id: { type: "string" } } },
        body: {
          type: "object",
          required: ["email"],
          properties: { email: { type: "string", format: "email" } },
        },
        response: { 200: { type: "object", properties: { ok: { type: "boolean" } } } },
      },
    },
    async (req, reply) => {
      const userId = (req as any).user.id as string;
      const { id } = req.params as { id: string };
      const { email } = req.body as { email: string };
      const result = await teamService.inviteMember(id, userId, email);
      if (result === "not-found") return reply.status(404).send({ error: "Team not found" });
      if (result === "forbidden") return reply.status(403).send({ error: "Not a member" });
      if (result === "user-not-found")
        return reply
          .status(404)
          .send({ error: "No account found with that email. Ask them to sign up first." });
      if (result === "already-member") return reply.status(409).send({ error: "Already a member" });
      return reply.send({ ok: true });
    }
  );

  // ── DELETE /v1/teams/:id/members/:userId ──────────────────────────────────

  app.delete(
    "/teams/:id/members/:userId",
    {
      schema: {
        tags: ["Teams"],
        summary: "Remove a member from the team (admin only)",
        params: {
          type: "object",
          properties: { id: { type: "string" }, userId: { type: "string" } },
        },
        response: { 200: { type: "object", properties: { ok: { type: "boolean" } } } },
      },
    },
    async (req, reply) => {
      const adminId = (req as any).user.id as string;
      const { id, userId } = req.params as { id: string; userId: string };
      const result = await teamService.removeMember(id, adminId, userId);
      if (result === "not-found") return reply.status(404).send({ error: "Team not found" });
      if (result === "forbidden") return reply.status(403).send({ error: "Admin only" });
      if (result === "cannot-remove-self")
        return reply.status(400).send({ error: "Cannot remove yourself" });
      if (result === "not-member") return reply.status(400).send({ error: "User is not a member" });
      if (result === "last-admin")
        return reply.status(400).send({ error: "Promote another admin first" });
      return reply.send({ ok: true });
    }
  );

  // ── PUT /v1/teams/:id/members/:userId/role ────────────────────────────────

  app.put(
    "/teams/:id/members/:userId/role",
    {
      schema: {
        tags: ["Teams"],
        summary: "Promote or demote a member's admin role (admin only)",
        params: {
          type: "object",
          properties: { id: { type: "string" }, userId: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["role"],
          properties: { role: { type: "string", enum: ["admin", "member"] } },
        },
        response: { 200: { type: "object", properties: { ok: { type: "boolean" } } } },
      },
    },
    async (req, reply) => {
      const adminId = (req as any).user.id as string;
      const { id, userId } = req.params as { id: string; userId: string };
      const { role } = req.body as { role: "admin" | "member" };
      const result = await teamService.setMemberRole(id, adminId, userId, role);
      if (result === "not-found") return reply.status(404).send({ error: "Team not found" });
      if (result === "forbidden") return reply.status(403).send({ error: "Admin only" });
      if (result === "not-member") return reply.status(400).send({ error: "User is not a member" });
      if (result === "last-admin")
        return reply.status(400).send({ error: "Promote another admin first" });
      return reply.send({ ok: true });
    }
  );

  // ── PUT /v1/teams/:id/members/:userId/password ────────────────────────────

  app.put(
    "/teams/:id/members/:userId/password",
    {
      schema: {
        tags: ["Teams"],
        summary: "Admin-forced password change for a team member",
        params: {
          type: "object",
          properties: { id: { type: "string" }, userId: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["newPassword"],
          properties: { newPassword: { type: "string", minLength: 6 } },
        },
        response: { 200: { type: "object", properties: { ok: { type: "boolean" } } } },
      },
    },
    async (req, reply) => {
      const adminId = (req as any).user.id as string;
      const { id, userId } = req.params as { id: string; userId: string };
      const { newPassword } = req.body as { newPassword: string };
      const result = await teamService.setMemberPassword(id, adminId, userId, newPassword);
      if (result === "not-found") return reply.status(404).send({ error: "Not found" });
      if (result === "forbidden") return reply.status(403).send({ error: "Admin only" });
      if (result === "not-member") return reply.status(400).send({ error: "User is not a member" });
      return reply.send({ ok: true });
    }
  );
}
