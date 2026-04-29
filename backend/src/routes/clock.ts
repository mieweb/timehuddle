import { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/require-auth.js";
import { clockService, toPublicClockEvent, subscribeSse } from "../services/clock.service.js";
import { clockEventsCollection } from "../models/index.js";

// ─── Public shape schema ──────────────────────────────────────────────────────

const ticketSessionShape = {
  type: "object",
  properties: {
    startTimestamp: { type: "number" },
    endTimestamp: { type: "number", nullable: true },
  },
};

const clockTicketShape = {
  type: "object",
  properties: {
    ticketId: { type: "string" },
    startTimestamp: { type: "number", nullable: true },
    accumulatedTime: { type: "number" },
    sessions: { type: "array", items: ticketSessionShape },
  },
};

const clockEventShape = {
  type: "object",
  properties: {
    id: { type: "string" },
    userId: { type: "string" },
    teamId: { type: "string" },
    startTimestamp: { type: "number" },
    accumulatedTime: { type: "number" },
    tickets: { type: "array", items: clockTicketShape },
    endTime: { type: "string", nullable: true },
    youtubeShortLink: { type: "string", nullable: true },
  },
};

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function clockRoutes(app: FastifyInstance) {
  // POST /v1/clock/start
  app.post(
    "/clock/start",
    {
      onRequest: [requireAuth],
      schema: {
        tags: ["Clock"],
        body: {
          type: "object",
          required: ["teamId"],
          properties: { teamId: { type: "string" } },
        },
        response: { 200: { type: "object", properties: { event: clockEventShape } } },
      },
    },
    async (req, reply) => {
      const { id: userId } = (req as any).user;
      const { teamId } = req.body as { teamId: string };
      const result = await clockService.start(userId, teamId);
      if (result === "forbidden") return reply.status(403).send({ error: "Forbidden" });
      return { event: result };
    }
  );

  // POST /v1/clock/stop
  app.post(
    "/clock/stop",
    {
      onRequest: [requireAuth],
      schema: {
        tags: ["Clock"],
        body: {
          type: "object",
          required: ["teamId"],
          properties: {
            teamId: { type: "string" },
            youtubeShortLink: { type: "string" },
          },
        },
        response: { 200: { type: "object", properties: { event: clockEventShape } } },
      },
    },
    async (req, reply) => {
      const { id: userId } = (req as any).user;
      const { teamId, youtubeShortLink } = req.body as {
        teamId: string;
        youtubeShortLink?: string;
      };
      const result = await clockService.stop(userId, teamId, youtubeShortLink);
      if (result === "not-found") return reply.status(404).send({ error: "No active clock event" });
      return { event: result };
    }
  );

  // POST /v1/clock/:id/ticket/start
  app.post(
    "/clock/:id/ticket/start",
    {
      onRequest: [requireAuth],
      schema: {
        tags: ["Clock"],
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        body: {
          type: "object",
          required: ["ticketId", "now"],
          properties: {
            ticketId: { type: "string" },
            now: { type: "number" },
          },
        },
        response: { 200: { type: "object", properties: { event: clockEventShape } } },
      },
    },
    async (req, reply) => {
      const { id: userId } = (req as any).user;
      const { id: clockEventId } = req.params as { id: string };
      const { ticketId, now } = req.body as { ticketId: string; now: number };
      const result = await clockService.addTicket(userId, clockEventId, ticketId, now);
      if (result === "not-found") return reply.status(404).send({ error: "Clock event not found" });
      if (result === "forbidden") return reply.status(403).send({ error: "Forbidden" });
      return { event: result };
    }
  );

  // POST /v1/clock/:id/ticket/stop
  app.post(
    "/clock/:id/ticket/stop",
    {
      onRequest: [requireAuth],
      schema: {
        tags: ["Clock"],
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        body: {
          type: "object",
          required: ["ticketId", "now"],
          properties: {
            ticketId: { type: "string" },
            now: { type: "number" },
          },
        },
        response: { 200: { type: "object", properties: { event: clockEventShape } } },
      },
    },
    async (req, reply) => {
      const { id: userId } = (req as any).user;
      const { id: clockEventId } = req.params as { id: string };
      const { ticketId, now } = req.body as { ticketId: string; now: number };
      const result = await clockService.stopTicket(userId, clockEventId, ticketId, now);
      if (result === "not-found") return reply.status(404).send({ error: "Clock event not found" });
      return { event: result };
    }
  );

  // PUT /v1/clock/:id/youtube
  app.put(
    "/clock/:id/youtube",
    {
      onRequest: [requireAuth],
      schema: {
        tags: ["Clock"],
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        body: {
          type: "object",
          required: ["youtubeShortLink"],
          properties: { youtubeShortLink: { type: "string" } },
        },
        response: { 200: { type: "object", properties: { event: clockEventShape } } },
      },
    },
    async (req, reply) => {
      const { id: userId } = (req as any).user;
      const { id: clockEventId } = req.params as { id: string };
      const { youtubeShortLink } = req.body as { youtubeShortLink: string };
      const result = await clockService.updateYoutubeLink(userId, clockEventId, youtubeShortLink);
      if (result === "not-found") return reply.status(404).send({ error: "Clock event not found" });
      return { event: result };
    }
  );

  // PUT /v1/clock/:id/times
  app.put(
    "/clock/:id/times",
    {
      onRequest: [requireAuth],
      schema: {
        tags: ["Clock"],
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        body: {
          type: "object",
          properties: {
            startTimestamp: { type: "number" },
            endTimestamp: { type: "number", nullable: true },
          },
        },
        response: { 200: { type: "object", properties: { event: clockEventShape } } },
      },
    },
    async (req, reply) => {
      const { id: userId } = (req as any).user;
      const { id: clockEventId } = req.params as { id: string };
      const data = req.body as { startTimestamp?: number; endTimestamp?: number | null };
      const result = await clockService.updateTimes(userId, clockEventId, data);
      if (result === "not-found") return reply.status(404).send({ error: "Clock event not found" });
      if (result === "forbidden") return reply.status(403).send({ error: "Forbidden" });
      if (result === "invalid-range")
        return reply.status(422).send({ error: "Clock-out cannot be earlier than clock-in" });
      return { event: result };
    }
  );

  // GET /v1/clock/timesheet
  app.get(
    "/clock/timesheet",
    {
      onRequest: [requireAuth],
      schema: {
        tags: ["Clock"],
        querystring: {
          type: "object",
          required: ["userId", "startDate", "endDate"],
          properties: {
            userId: { type: "string" },
            startDate: { type: "string" },
            endDate: { type: "string" },
          },
        },
      },
    },
    async (req, reply) => {
      const { id: requesterId } = (req as any).user;
      const { userId, startDate, endDate } = req.query as {
        userId: string;
        startDate: string;
        endDate: string;
      };
      const result = await clockService.getTimesheet(requesterId, userId, startDate, endDate);
      if (result === "forbidden") return reply.status(403).send({ error: "Forbidden" });
      return result;
    }
  );

  // GET /v1/clock/active — current user's active event (any team)
  app.get(
    "/clock/active",
    {
      onRequest: [requireAuth],
      schema: {
        tags: ["Clock"],
        response: {
          200: {
            type: "object",
            properties: { event: { ...clockEventShape, nullable: true } },
          },
        },
      },
    },
    async (req) => {
      const { id: userId } = (req as any).user;
      const event = await clockService.getActiveForUser(userId);
      return { event: event ? toPublicClockEvent(event) : null };
    }
  );

  // GET /v1/clock/events — all events for current user
  app.get(
    "/clock/events",
    {
      onRequest: [requireAuth],
      schema: { tags: ["Clock"] },
    },
    async (req) => {
      const { id: userId } = (req as any).user;
      const events = await clockService.getForUser(userId);
      return { events: events.map(toPublicClockEvent) };
    }
  );

  // GET /v1/clock/live?teamIds=id1,id2 — SSE stream for live team clock state
  app.get(
    "/clock/live",
    {
      onRequest: [requireAuth],
      schema: {
        tags: ["Clock"],
        querystring: {
          type: "object",
          required: ["teamIds"],
          properties: { teamIds: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      const { teamIds: teamIdsParam } = req.query as { teamIds: string };
      const teamIds = teamIdsParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      // Hijack the response — prevents Fastify from finalizing/closing it.
      // Because hijack() bypasses @fastify/cors hooks, we must set CORS headers manually.
      reply.hijack();

      const trustedOrigins = process.env.TRUSTED_ORIGINS
        ? process.env.TRUSTED_ORIGINS.split(",").map((o) => o.trim())
        : [];
      const requestOrigin = req.headers.origin ?? "";
      const allowOrigin = trustedOrigins.includes(requestOrigin) ? requestOrigin : "";

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        ...(allowOrigin && {
          "Access-Control-Allow-Origin": allowOrigin,
          "Access-Control-Allow-Credentials": "true",
        }),
      });
      reply.raw.flushHeaders();

      // Initial snapshot — all currently active events for these teams
      const initial = await clockService.getLiveForTeams(teamIds);
      const snapshot = initial.map(toPublicClockEvent);
      reply.raw.write(`data: ${JSON.stringify({ type: "snapshot", events: snapshot })}\n\n`);

      // Subscribe to future broadcasts
      const unsub = subscribeSse((teamId, event) => {
        if (!teamIds.includes(teamId)) return;
        reply.raw.write(`data: ${JSON.stringify({ type: "update", teamId, event })}\n\n`);
      });

      // Keepalive ping every 25s
      const ping = setInterval(() => {
        reply.raw.write(": ping\n\n");
      }, 25_000);

      req.raw.on("close", () => {
        unsub();
        clearInterval(ping);
      });
    }
  );
}
