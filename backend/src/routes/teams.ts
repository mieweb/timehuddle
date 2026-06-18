import type { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/require-auth.js";
import { teamService } from "../services/team.service.js";
import { teamJoinRequestService } from "../services/team-join-request.service.js";

// Reusable team shape for Swagger response schemas
const teamShape = {
  type: "object",
  properties: {
    id: { type: "string" },
    orgId: { type: "string" },
    parentTeamId: { type: ["string", "null"] },
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
    username: { type: "string", nullable: true },
    image: { type: "string", nullable: true },
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
        summary: "List teams for current user with pending join requests",
        response: {
          200: {
            type: "object",
            properties: {
              teams: { type: "array", items: teamShape },
              pendingRequests: { type: "array" },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const userId = (req as any).user.id as string;
      const teams = await teamService.getTeamsForUser(userId);

      // Get pending requests where user is the requester
      const userPendingRequests = await teamJoinRequestService.getPendingForUser(userId);

      // Get pending requests for teams where user is an admin
      const adminTeamIds = teams.filter((t) => t.admins.includes(userId)).map((t) => t.id);
      const adminPendingRequestsResults = await Promise.all(
        adminTeamIds.map((teamId) => teamJoinRequestService.getPendingForTeam(teamId, userId))
      );

      // Filter out error results and flatten
      const adminPendingRequests = adminPendingRequestsResults
        .filter((r) => Array.isArray(r))
        .flat();

      // Combine both lists (user's own requests + requests for teams they admin)
      const pendingRequests = [...userPendingRequests, ...adminPendingRequests];

      return reply.send({ teams, pendingRequests });
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
        summary: "Join a team by code - creates a pending approval request",
        body: {
          type: "object",
          required: ["teamCode"],
          properties: { teamCode: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "string", enum: ["pending", "joined"] },
              request: { type: "object" },
              team: teamShape,
            },
          },
        },
      },
    },
    async (req, reply) => {
      const userId = (req as any).user.id as string;
      const { teamCode } = req.body as { teamCode: string };
      const result = await teamService.joinByCode(userId, teamCode);
      if (result === "not-found")
        return (reply as any).status(404).send({ error: "Team not found" });
      if (result === "already-member")
        return (reply as any).status(409).send({ error: "Already a member" });

      // Result is a PublicTeamJoinRequest (pending approval)
      return reply.send({ status: "pending", request: result });
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
            orgId: { type: "string", pattern: "^[0-9a-f]{24}$" },
            parentTeamId: {
              anyOf: [{ type: "string", pattern: "^[0-9a-f]{24}$" }, { type: "null" }],
            },
          },
        },
        response: { 201: { type: "object", properties: { team: teamShape } } },
      },
    },
    async (req, reply) => {
      const userId = (req as any).user.id as string;
      const { name, description, orgId, parentTeamId } = req.body as {
        name: string;
        description?: string;
        orgId?: string;
        parentTeamId?: string | null;
      };
      const team = await teamService.createTeam(userId, { name, description, orgId, parentTeamId });
      return (reply as any).status(201).send({ team });
    }
  );

  app.get(
    "/teams/:id/subteams",
    {
      schema: {
        tags: ["Teams"],
        summary: "List sub-teams for a parent team",
        params: { type: "object", properties: { id: { type: "string" } } },
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
      const { id } = req.params as { id: string };
      const result = await teamService.getSubTeams(id, userId);
      if (result === "not-found") {
        return (reply as any).status(404).send({ error: "Team not found" });
      }
      if (result === "forbidden") {
        return (reply as any).status(403).send({ error: "Forbidden" });
      }
      return reply.send({ teams: result });
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
      if (result === "not-found")
        return (reply as any).status(404).send({ error: "Team not found" });
      if (result === "forbidden") return (reply as any).status(403).send({ error: "Admin only" });
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
      if (result === "not-found")
        return (reply as any).status(404).send({ error: "Team not found" });
      if (result === "forbidden") return (reply as any).status(403).send({ error: "Admin only" });
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
      if (result === "not-found")
        return (reply as any).status(404).send({ error: "Team not found" });
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
      if (result === "not-found")
        return (reply as any).status(404).send({ error: "Team not found" });
      if (result === "forbidden") return (reply as any).status(403).send({ error: "Not a member" });
      if (result === "user-not-found")
        return (reply as any)
          .status(404)
          .send({ error: "No account found with that email. Ask them to sign up first." });
      if (result === "already-member")
        return (reply as any).status(409).send({ error: "Already a member" });
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
      if (result === "not-found")
        return (reply as any).status(404).send({ error: "Team not found" });
      if (result === "forbidden") return (reply as any).status(403).send({ error: "Admin only" });
      if (result === "cannot-remove-self")
        return (reply as any).status(400).send({ error: "Cannot remove yourself" });
      if (result === "not-member")
        return (reply as any).status(400).send({ error: "User is not a member" });
      if (result === "last-admin")
        return (reply as any).status(400).send({ error: "Promote another admin first" });
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
      if (result === "not-found")
        return (reply as any).status(404).send({ error: "Team not found" });
      if (result === "forbidden") return (reply as any).status(403).send({ error: "Admin only" });
      if (result === "not-member")
        return (reply as any).status(400).send({ error: "User is not a member" });
      if (result === "last-admin")
        return (reply as any).status(400).send({ error: "Promote another admin first" });
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
      if (result === "not-found") return (reply as any).status(404).send({ error: "Not found" });
      if (result === "forbidden") return (reply as any).status(403).send({ error: "Admin only" });
      if (result === "not-member")
        return (reply as any).status(400).send({ error: "User is not a member" });
      return reply.send({ ok: true });
    }
  );

  // ── GET /v1/teams/:teamId/join-requests ───────────────────────────────────

  app.get(
    "/teams/:teamId/join-requests",
    {
      schema: {
        tags: ["Teams"],
        summary: "List pending join requests for a team (admin only)",
        params: {
          type: "object",
          properties: { teamId: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            properties: {
              requests: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    teamId: { type: "string" },
                    userId: { type: "string" },
                    status: { type: "string" },
                    requestedAt: { type: "string" },
                    user: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        name: { type: "string" },
                        email: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const userId = (req as any).user.id as string;
      const { teamId } = req.params as { teamId: string };
      const result = await teamJoinRequestService.getPendingForTeam(teamId, userId);
      if (result === "not-found")
        return (reply as any).status(404).send({ error: "Team not found" });
      if (result === "forbidden")
        return (reply as any).status(403).send({ error: "Admin access required" });
      return reply.send({ requests: result });
    }
  );

  // ── POST /v1/teams/join-requests/:requestId/approve ───────────────────────

  app.post(
    "/teams/join-requests/:requestId/approve",
    {
      schema: {
        tags: ["Teams"],
        summary: "Approve a team join request (admin only)",
        params: {
          type: "object",
          properties: { requestId: { type: "string" } },
        },
        response: {
          200: { type: "object", properties: { status: { type: "string" } } },
        },
      },
    },
    async (req, reply) => {
      const userId = (req as any).user.id as string;
      const { requestId } = req.params as { requestId: string };
      const result = await teamJoinRequestService.approve(requestId, userId);
      if (result === "not-found")
        return (reply as any).status(404).send({ error: "Request not found" });
      if (result === "forbidden")
        return (reply as any).status(403).send({ error: "Admin access required" });
      if (result === "already-processed")
        return (reply as any).status(409).send({ error: "Request already processed" });
      return reply.send({ status: "ok" });
    }
  );

  // ── POST /v1/teams/join-requests/:requestId/decline ───────────────────────

  app.post(
    "/teams/join-requests/:requestId/decline",
    {
      schema: {
        tags: ["Teams"],
        summary: "Decline a team join request (admin only)",
        params: {
          type: "object",
          properties: { requestId: { type: "string" } },
        },
        response: {
          200: { type: "object", properties: { status: { type: "string" } } },
        },
      },
    },
    async (req, reply) => {
      const userId = (req as any).user.id as string;
      const { requestId } = req.params as { requestId: string };
      const result = await teamJoinRequestService.decline(requestId, userId);
      if (result === "not-found")
        return (reply as any).status(404).send({ error: "Request not found" });
      if (result === "forbidden")
        return (reply as any).status(403).send({ error: "Admin access required" });
      if (result === "already-processed")
        return (reply as any).status(409).send({ error: "Request already processed" });
      return reply.send({ status: "ok" });
    }
  );
}
