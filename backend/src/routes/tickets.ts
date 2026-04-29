import { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/require-auth.js";
import { ticketService } from "../services/ticket.service.js";
import type { Ticket, TicketStatus } from "../models/ticket.model.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toPublicTicket(t: Ticket) {
  return {
    id: t._id.toHexString(),
    teamId: t.teamId,
    title: t.title,
    github: t.github,
    accumulatedTime: t.accumulatedTime,
    startTimestamp: t.startTimestamp ?? null,
    status: t.status,
    createdBy: t.createdBy,
    assignedTo: t.assignedTo,
    reviewedBy: t.reviewedBy ?? null,
    reviewedAt: t.reviewedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt?.toISOString() ?? null,
  };
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const ticketShape = {
  type: "object",
  properties: {
    id: { type: "string" },
    teamId: { type: "string" },
    title: { type: "string" },
    github: { type: "string" },
    accumulatedTime: { type: "number" },
    startTimestamp: { type: "number", nullable: true },
    status: { type: "string", enum: ["open", "reviewed", "deleted", "closed"] },
    createdBy: { type: "string" },
    assignedTo: { type: "string", nullable: true },
    reviewedBy: { type: "string", nullable: true },
    reviewedAt: { type: "string", nullable: true },
    createdAt: { type: "string" },
    updatedAt: { type: "string", nullable: true },
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
      return reply.send({ tickets: result.map(toPublicTicket) });
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
            accumulatedTime: { type: "number", minimum: 0, default: 0 },
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
        accumulatedTime: number;
      };
      const result = await ticketService.create({
        teamId: body.teamId,
        title: body.title,
        github: body.github ?? "",
        accumulatedTime: body.accumulatedTime ?? 0,
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
        summary: "Update a ticket (owner only)",
        params: idParam,
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string", minLength: 1, maxLength: 500 },
            github: { type: "string", maxLength: 1000 },
            accumulatedTime: { type: "number", minimum: 0 },
            status: { type: "string", enum: ["open", "reviewed", "deleted", "closed"] },
          },
        },
        response: {
          200: { type: "object", properties: { ticket: ticketShape } },
          ...unauth,
          403: err("Not your ticket"),
          404: err("Ticket not found"),
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as Partial<{
        title: string;
        github: string;
        accumulatedTime: number;
        status: TicketStatus;
      }>;
      const result = await ticketService.update(id, req.user!.id, body);
      if (result === "not-found") return reply.status(404).send({ error: "Ticket not found" });
      if (result === "forbidden") return reply.status(403).send({ error: "Not your ticket" });
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
        summary: "Delete a ticket (owner only, soft-delete)",
        params: idParam,
        response: {
          200: { type: "object", properties: { ok: { type: "boolean" } } },
          ...unauth,
          403: err("Not your ticket"),
          404: err("Ticket not found"),
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const result = await ticketService.delete(id, req.user!.id);
      if (result === "not-found") return reply.status(404).send({ error: "Ticket not found" });
      if (result === "forbidden") return reply.status(403).send({ error: "Not your ticket" });
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
            status: { type: "string", enum: ["open", "reviewed", "deleted", "closed"] },
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

  // POST /v1/tickets/:id/start
  app.post(
    "/tickets/:id/start",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Tickets"],
        summary: "Start ticket timer (owner only)",
        params: idParam,
        body: {
          type: "object",
          required: ["now"],
          additionalProperties: false,
          properties: { now: { type: "number" } },
        },
        response: {
          200: { type: "object", properties: { ticket: ticketShape } },
          ...unauth,
          403: err("Not your ticket"),
          404: err("Ticket not found"),
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { now } = req.body as { now: number };
      const result = await ticketService.startTimer(id, req.user!.id, now);
      if (result === "not-found") return reply.status(404).send({ error: "Ticket not found" });
      if (result === "forbidden") return reply.status(403).send({ error: "Not your ticket" });
      return reply.send({ ticket: toPublicTicket(result) });
    }
  );

  // POST /v1/tickets/:id/stop
  app.post(
    "/tickets/:id/stop",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Tickets"],
        summary: "Stop ticket timer and accumulate elapsed time (owner only)",
        params: idParam,
        body: {
          type: "object",
          required: ["now"],
          additionalProperties: false,
          properties: { now: { type: "number" } },
        },
        response: {
          200: { type: "object", properties: { ticket: ticketShape } },
          ...unauth,
          403: err("Not your ticket"),
          404: err("Ticket not found"),
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { now } = req.body as { now: number };
      const result = await ticketService.stopTimer(id, req.user!.id, now);
      if (result === "not-found") return reply.status(404).send({ error: "Ticket not found" });
      if (result === "forbidden") return reply.status(403).send({ error: "Not your ticket" });
      return reply.send({ ticket: toPublicTicket(result) });
    }
  );

  // PUT /v1/tickets/:id/assign
  app.put(
    "/tickets/:id/assign",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Tickets"],
        summary: "Assign ticket to a team member (team admin only)",
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
