import { FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";
import { requireAuth } from "../middleware/require-auth.js";
import { ticketService } from "../services/ticket.service.js";
import { activityService } from "../services/activity.service.js";
import { teamsCollection, ticketsCollection, usersCollection } from "../models/index.js";
import type { Ticket, TicketPriority, TicketStatus } from "../models/ticket.model.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Resolve an array of user IDs to a map of id → display name. */
async function resolveUserNames(ids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return {};
  const users = await usersCollection()
    .find(
      { _id: { $in: unique.map((id) => new ObjectId(id)) } },
      { projection: { _id: 1, name: 1 } }
    )
    .toArray();
  return Object.fromEntries(users.map((u) => [u._id.toHexString(), u.name ?? ""]));
}

function toPublicTicket(t: Ticket) {
  return {
    id: t._id.toHexString(),
    teamId: t.teamId,
    title: t.title,
    description: t.description ?? null,
    github: t.github,
    status: t.status,
    priority: t.priority ?? null,
    createdBy: t.createdBy,
    assignedTo: t.assignedTo,
    reviewedBy: t.reviewedBy ?? null,
    reviewedAt: t.reviewedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt?.toISOString() ?? null,
    sharedWithTimeharbor: t.sharedWithTimeharbor ?? false,
    externalTrackedMs: t.externalTrackedMs ?? 0,
  };
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const ALL_STATUSES = ["open", "in-progress", "blocked", "reviewed", "closed", "deleted"] as const;
const ALL_PRIORITIES = ["low", "medium", "high", "critical"] as const;

const ticketShape = {
  type: "object",
  properties: {
    id: { type: "string" },
    teamId: { type: "string" },
    title: { type: "string" },
    description: { type: "string", nullable: true },
    github: { type: "string" },
    status: { type: "string", enum: ALL_STATUSES },
    priority: { type: "string", enum: ALL_PRIORITIES, nullable: true },
    createdBy: { type: "string" },
    assignedTo: { type: "string", nullable: true },
    reviewedBy: { type: "string", nullable: true },
    reviewedAt: { type: "string", nullable: true },
    createdAt: { type: "string" },
    updatedAt: { type: "string", nullable: true },
    sharedWithTimeharbor: { type: "boolean" },
    externalTrackedMs: { type: "number" },
    createdByName: { type: "string" },
    assignedToName: { type: "string", nullable: true },
  },
};

const idParam = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", pattern: "^[0-9a-f]{24}$" } },
};

const err = (description: string) => ({
  type: "object",
  properties: { error: { type: "string", example: description } },
});

const unauth = { 401: err("Unauthorized") };

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function ticketRoutes(app: FastifyInstance) {
  // GET /v1/tickets/shared-with-timeharbor — all flagged tickets across user's teams
  app.get(
    "/tickets/shared-with-timeharbor",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Tickets"],
        summary: "List all tickets flagged as shared with TimeHarbor (across all user teams)",
        response: {
          200: { type: "object", properties: { tickets: { type: "array", items: ticketShape } } },
          ...unauth,
        },
      },
    },
    async (req, reply) => {
      const tickets = await ticketService.findSharedWithTimeharbor(req.user!.id);
      const userIds = tickets.flatMap((t) => [t.createdBy, t.assignedTo ?? ""].filter(Boolean));
      const names = await resolveUserNames(userIds);
      return reply.send({
        tickets: tickets.map((t) => ({
          ...toPublicTicket(t),
          createdByName: names[t.createdBy] ?? "",
          assignedToName: t.assignedTo ? (names[t.assignedTo] ?? "") : null,
        })),
      });
    }
  );

  // GET /v1/tickets?teamId=
  app.get(
    "/tickets",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Tickets"],
        summary: "List tickets for a team (members only)",
        querystring: {
          type: "object",
          required: ["teamId"],
          properties: { teamId: { type: "string" } },
        },
        response: {
          200: { type: "object", properties: { tickets: { type: "array", items: ticketShape } } },
          ...unauth,
          403: err("Not a team member"),
        },
      },
    },
    async (req, reply) => {
      const { teamId } = req.query as { teamId: string };
      const result = await ticketService.findByTeam(teamId, req.user!.id);
      if (result === "forbidden") return reply.status(403).send({ error: "Not a team member" });
      const userIds = result.flatMap((t) => [t.createdBy, t.assignedTo ?? ""].filter(Boolean));
      const names = await resolveUserNames(userIds);
      return reply.send({
        tickets: result.map((t) => ({
          ...toPublicTicket(t),
          createdByName: names[t.createdBy] ?? "",
          assignedToName: t.assignedTo ? (names[t.assignedTo] ?? "") : null,
        })),
      });
    }
  );

  // GET /v1/tickets/:id
  app.get(
    "/tickets/:id",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Tickets"],
        summary: "Get a single ticket by ID (team members only)",
        params: idParam,
        response: {
          200: { type: "object", properties: { ticket: ticketShape } },
          ...unauth,
          403: err("Not a team member"),
          404: err("Ticket not found"),
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const ticket = await ticketService.findById(id);
      if (!ticket) return reply.status(404).send({ error: "Ticket not found" });
      const team = await teamsCollection().findOne({
        _id: new ObjectId(ticket.teamId),
        members: req.user!.id,
      });
      if (!team) return reply.status(403).send({ error: "Not a team member" });
      return reply.send({ ticket: toPublicTicket(ticket) });
    }
  );

  // GET /v1/tickets/:id/activity
  app.get(
    "/tickets/:id/activity",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Tickets"],
        summary: "Get activity events for a ticket (team members only)",
        params: idParam,
        querystring: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              events: { type: "array", items: { type: "object", additionalProperties: true } },
            },
          },
          ...unauth,
          403: err("Not a team member"),
          404: err("Ticket not found"),
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { limit } = req.query as { limit?: number };
      const ticket = await ticketService.findById(id);
      if (!ticket) return reply.status(404).send({ error: "Ticket not found" });
      const team = await teamsCollection().findOne({
        _id: new ObjectId(ticket.teamId),
        members: req.user!.id,
      });
      if (!team) return reply.status(403).send({ error: "Not a team member" });
      return reply.send(await activityService.getTicketActivity(id, limit));
    }
  );

  // POST /v1/tickets
  app.post(
    "/tickets",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Tickets"],
        summary: "Create a ticket (team members only)",
        body: {
          type: "object",
          required: ["teamId", "title"],
          additionalProperties: false,
          properties: {
            teamId: { type: "string" },
            title: { type: "string", minLength: 1, maxLength: 500 },
            github: { type: "string", maxLength: 1000, default: "" },
          },
        },
        response: {
          201: { type: "object", properties: { ticket: ticketShape } },
          ...unauth,
          403: err("Not a team member"),
        },
      },
    },
    async (req, reply) => {
      const body = req.body as {
        teamId: string;
        title: string;
        github: string;
      };
      const result = await ticketService.create({
        teamId: body.teamId,
        title: body.title,
        github: body.github ?? "",
        createdBy: req.user!.id,
      });
      if (result === "forbidden") return reply.status(403).send({ error: "Not a team member" });
      const ticket = await ticketService.findById(result.id);
      return reply.status(201).send({ ticket: toPublicTicket(ticket!) });
    }
  );

  // PUT /v1/tickets/:id
  app.put(
    "/tickets/:id",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Tickets"],
        summary: "Update a ticket (any team member)",
        params: idParam,
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string", minLength: 1, maxLength: 500 },
            description: { type: "string", maxLength: 5000 },
            github: { type: "string", maxLength: 1000 },
          },
        },
        response: {
          200: { type: "object", properties: { ticket: ticketShape } },
          ...unauth,
          403: err("Not a team member"),
          404: err("Ticket not found"),
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as Partial<{
        title: string;
        description: string;
        github: string;
      }>;
      const result = await ticketService.update(id, req.user!.id, body);
      if (result === "not-found") return reply.status(404).send({ error: "Ticket not found" });
      if (result === "forbidden") return reply.status(403).send({ error: "Not a team member" });
      return reply.send({ ticket: toPublicTicket(result) });
    }
  );

  // DELETE /v1/tickets/:id  (soft-delete: status → "deleted")
  app.delete(
    "/tickets/:id",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Tickets"],
        summary: "Delete a ticket (any team member, soft-delete)",
        params: idParam,
        response: {
          200: { type: "object", properties: { ok: { type: "boolean" } } },
          ...unauth,
          403: err("Not a team member"),
          404: err("Ticket not found"),
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const result = await ticketService.delete(id, req.user!.id);
      if (result === "not-found") return reply.status(404).send({ error: "Ticket not found" });
      if (result === "forbidden") return reply.status(403).send({ error: "Not a team member" });
      return reply.send({ ok: true });
    }
  );

  // POST /v1/tickets/batch-status  — must be registered before /:id routes to prevent conflict
  app.post(
    "/tickets/batch-status",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Tickets"],
        summary: "Batch update ticket status (team admin only)",
        body: {
          type: "object",
          required: ["ticketIds", "status", "teamId"],
          additionalProperties: false,
          properties: {
            ticketIds: { type: "array", items: { type: "string" }, minItems: 1 },
            status: { type: "string", enum: ALL_STATUSES },
            teamId: { type: "string" },
          },
        },
        response: {
          200: { type: "object", properties: { modified: { type: "number" } } },
          ...unauth,
          403: err("Not a team admin"),
        },
      },
    },
    async (req, reply) => {
      const { ticketIds, status, teamId } = req.body as {
        ticketIds: string[];
        status: TicketStatus;
        teamId: string;
      };
      const result = await ticketService.batchUpdateStatus(ticketIds, teamId, status, req.user!.id);
      if (result === "forbidden") return reply.status(403).send({ error: "Not a team admin" });
      return reply.send({ modified: result });
    }
  );

  // PATCH /v1/tickets/:id/external-update — accept time/status/description pushed from TimeHarbor
  app.patch(
    "/tickets/:id/external-update",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Tickets"],
        summary: "Accept an external update from TimeHarbor (time, status, description, github)",
        params: idParam,
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            addMs: { type: "number", minimum: 0 },
            status: { type: "string", enum: ALL_STATUSES },
            description: { type: "string", maxLength: 5000 },
            github: { type: "string", maxLength: 1000 },
          },
        },
        response: {
          200: { type: "object", properties: { ticket: ticketShape } },
          ...unauth,
          403: err("Not a team member"),
          404: err("Ticket not found"),
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as {
        addMs?: number;
        status?: TicketStatus;
        description?: string;
        github?: string;
      };
      const ticket = await ticketService.findById(id);
      if (!ticket) return reply.status(404).send({ error: "Ticket not found" });
      const team = await teamsCollection().findOne({
        _id: new ObjectId(ticket.teamId),
        $or: [{ members: req.user!.id }, { admins: req.user!.id }],
      });
      if (!team) return reply.status(403).send({ error: "Not a team member" });

      const $set: Record<string, unknown> = { updatedAt: new Date() };
      const $inc: Record<string, unknown> = {};
      if (body.status !== undefined) $set.status = body.status;
      if (body.description !== undefined) $set.description = body.description;
      if (body.github !== undefined) $set.github = body.github;
      if (body.addMs && body.addMs > 0) $inc.externalTrackedMs = body.addMs;

      const update: Record<string, unknown> = { $set };
      if (Object.keys($inc).length > 0) update.$inc = $inc;

      await ticketsCollection().updateOne({ _id: new ObjectId(id) }, update);
      const updated = await ticketService.findById(id);
      return reply.send({ ticket: toPublicTicket(updated!) });
    }
  );

  // PATCH /v1/tickets/:id/status-priority — any team member
  app.patch(
    "/tickets/:id/status-priority",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Tickets"],
        summary: "Update ticket status and/or priority (any team member)",
        params: idParam,
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            status: { type: "string", enum: ALL_STATUSES },
            priority: { type: "string", enum: ALL_PRIORITIES },
          },
        },
        response: {
          200: { type: "object", properties: { ticket: ticketShape } },
          ...unauth,
          403: err("Not a team member"),
          404: err("Ticket not found"),
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as { status?: TicketStatus; priority?: TicketPriority };
      const result = await ticketService.updateStatusPriority(id, req.user!.id, body);
      if (result === "not-found") return reply.status(404).send({ error: "Ticket not found" });
      if (result === "forbidden") return reply.status(403).send({ error: "Not a team member" });
      return reply.send({ ticket: toPublicTicket(result) });
    }
  );

  // PATCH /v1/tickets/:id/timeharbor-share — flag a single ticket for TimeHarbor import
  app.patch(
    "/tickets/:id/timeharbor-share",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Tickets"],
        summary: "Flag (or unflag) a ticket for TimeHarbor import",
        params: idParam,
        body: {
          type: "object",
          required: ["shared"],
          additionalProperties: false,
          properties: { shared: { type: "boolean" } },
        },
        response: {
          200: { type: "object", properties: { ticket: ticketShape } },
          ...unauth,
          403: err("Not a team member"),
          404: err("Ticket not found"),
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { shared } = req.body as { shared: boolean };
      const ticket = await ticketService.findById(id);
      if (!ticket) return reply.status(404).send({ error: "Ticket not found" });
      const team = await teamsCollection().findOne({
        _id: new ObjectId(ticket.teamId),
        $or: [{ members: req.user!.id }, { admins: req.user!.id }],
      });
      if (!team) return reply.status(403).send({ error: "Not a team member" });
      await ticketsCollection().updateOne(
        { _id: new ObjectId(id) },
        { $set: { sharedWithTimeharbor: shared, updatedAt: new Date() } }
      );
      const updated = await ticketService.findById(id);
      return reply.send({ ticket: toPublicTicket(updated!) });
    }
  );

  // PATCH /v1/tickets/bulk-timeharbor-share — flag multiple tickets at once
  // NOTE: registered before /:id routes to avoid route conflict
  app.patch(
    "/tickets/bulk-timeharbor-share",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Tickets"],
        summary: "Flag (or unflag) multiple tickets for TimeHarbor import",
        body: {
          type: "object",
          required: ["ticketIds", "shared"],
          additionalProperties: false,
          properties: {
            ticketIds: { type: "array", items: { type: "string" }, minItems: 1 },
            shared: { type: "boolean" },
          },
        },
        response: {
          200: { type: "object", properties: { modified: { type: "number" } } },
          ...unauth,
          403: err("Not a team member for all tickets"),
        },
      },
    },
    async (req, reply) => {
      const { ticketIds, shared } = req.body as { ticketIds: string[]; shared: boolean };
      // Verify user is a member of every team that owns these tickets
      const validIds = ticketIds.filter((id) => /^[0-9a-f]{24}$/i.test(id));
      const tickets = await ticketsCollection()
        .find({ _id: { $in: validIds.map((id) => new ObjectId(id)) } })
        .toArray();
      const teamIds = [...new Set(tickets.map((t) => t.teamId))];
      for (const teamId of teamIds) {
        const member = await teamsCollection().findOne({
          _id: new ObjectId(teamId),
          $or: [{ members: req.user!.id }, { admins: req.user!.id }],
        });
        if (!member) return reply.status(403).send({ error: "Not a team member for all tickets" });
      }
      const result = await ticketsCollection().updateMany(
        { _id: { $in: validIds.map((id) => new ObjectId(id)) } },
        { $set: { sharedWithTimeharbor: shared, updatedAt: new Date() } }
      );
      return reply.send({ modified: result.modifiedCount });
    }
  );

  // PUT /v1/tickets/:id/assign
  app.put(
    "/tickets/:id/assign",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Tickets"],
        summary: "Assign ticket to a team member (any team member)",
        params: idParam,
        body: {
          type: "object",
          required: ["assignedToUserId"],
          additionalProperties: false,
          properties: {
            assignedToUserId: { type: ["string", "null"] },
          },
        },
        response: {
          200: { type: "object", properties: { ticket: ticketShape } },
          ...unauth,
          403: err("Not a team admin"),
          404: err("Ticket not found"),
          422: err("Assignee must be a team member"),
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { assignedToUserId } = req.body as { assignedToUserId: string | null };
      const result = await ticketService.assign(id, req.user!.id, assignedToUserId);
      if (result === "not-found") return reply.status(404).send({ error: "Ticket not found" });
      if (result === "forbidden") return reply.status(403).send({ error: "Not a team admin" });
      if (result === "bad-assignee")
        return reply.status(422).send({ error: "Assignee must be a team member" });
      return reply.send({ ticket: toPublicTicket(result) });
    }
  );
}
