import { FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";
import { auth } from "../lib/auth.js";
import { requireAuth } from "../middleware/require-auth.js";
import { clockService, toPublicClockEvent, subscribe } from "../services/clock.service.js";
import { teamsCollection } from "../models/index.js";

// ─── Public shape schema ──────────────────────────────────────────────────────

const clockEventShape = {
  type: "object",
  properties: {
    id: { type: "string" },
    userId: { type: "string" },
    teamId: { type: "string" },
    startTime: { type: "number" },
    accumulatedTime: { type: "number" },
    endTime: { type: "number", nullable: true },
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
      if (result === "forbidden") return (reply as any).status(403).send({ error: "Forbidden" });
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
          },
        },
        response: { 200: { type: "object", properties: { event: clockEventShape } } },
      },
    },
    async (req, reply) => {
      const { id: userId } = (req as any).user;
      const { teamId } = req.body as { teamId: string };
      const result = await clockService.stop(userId, teamId);
      if (result === "not-found")
        return (reply as any).status(404).send({ error: "No active clock event" });
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
            startTime: { type: "number" },
            endTime: { type: "number", nullable: true },
          },
        },
        response: { 200: { type: "object", properties: { event: clockEventShape } } },
      },
    },
    async (req, reply) => {
      const { id: userId } = (req as any).user;
      const { id: clockEventId } = req.params as { id: string };
      const data = req.body as { startTime?: number; endTime?: number | null };
      const result = await clockService.updateTimes(userId, clockEventId, data);
      if (result === "not-found")
        return (reply as any).status(404).send({ error: "Clock event not found" });
      if (result === "forbidden") return (reply as any).status(403).send({ error: "Forbidden" });
      if (result === "invalid-range")
        return (reply as any)
          .status(422)
          .send({ error: "Clock-out cannot be earlier than clock-in" });
      return { event: result };
    }
  );

  // DELETE /v1/clock/:id
  app.delete(
    "/clock/:id",
    {
      onRequest: [requireAuth],
      schema: {
        tags: ["Clock"],
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        response: { 200: { type: "object", properties: { ok: { type: "boolean" } } } },
      },
    },
    async (req, reply) => {
      const { id: userId } = (req as any).user;
      const { id: clockEventId } = req.params as { id: string };
      const result = await clockService.deleteEvent(userId, clockEventId);
      if (result === "not-found")
        return (reply as any).status(404).send({ error: "Clock event not found" });
      if (result === "forbidden") return (reply as any).status(403).send({ error: "Forbidden" });
      return { ok: true };
    }
  );

  // POST /v1/clock/manual — create a completed past clock entry
  app.post(
    "/clock/manual",
    {
      onRequest: [requireAuth],
      schema: {
        tags: ["Clock"],
        body: {
          type: "object",
          required: ["teamId", "startTime", "endTime"],
          properties: {
            teamId: { type: "string" },
            startTime: { type: "number" },
            endTime: { type: "number" },
          },
        },
        response: { 201: { type: "object", properties: { event: clockEventShape } } },
      },
    },
    async (req, reply) => {
      const { id: userId } = (req as any).user;
      const { teamId, startTime, endTime } = req.body as {
        teamId: string;
        startTime: number;
        endTime: number;
      };
      const result = await clockService.createManual(userId, teamId, startTime, endTime);
      if (result === "forbidden") return (reply as any).status(403).send({ error: "Forbidden" });
      if (result === "invalid-range")
        return (reply as any)
          .status(422)
          .send({ error: "Times must be in the past and clock-out must be after clock-in." });
      return reply.status(201).send({ event: result });
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
          required: ["userId", "startMs", "endMs"],
          properties: {
            userId: { type: "string" },
            startMs: { type: "number" },
            endMs: { type: "number" },
          },
        },
      },
    },
    async (req, reply) => {
      const { id: requesterId } = (req as any).user;
      const { userId, startMs, endMs } = req.query as {
        userId: string;
        startMs: number;
        endMs: number;
      };
      const result = await clockService.getTimesheet(requesterId, userId, startMs, endMs);
      if (result === "forbidden") return (reply as any).status(403).send({ error: "Forbidden" });
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

  // GET /v1/clock/ws?teamIds=id1,id2 — WebSocket stream for live team clock state
  app.get("/clock/ws", { websocket: true }, async (socket, req) => {
    const { token: queryToken, teamIds: teamIdsParam } = req.query as {
      token?: string;
      teamIds?: string;
    };

    // Auth: accept Bearer token from query param (Capacitor) or cookie
    const headers: Record<string, string> = { ...(req.headers as any) };
    if (queryToken) headers["authorization"] = `Bearer ${queryToken}`;
    const session = await auth.api.getSession({ headers });
    if (!session?.user) {
      socket.close(4001, "Unauthorized");
      return;
    }

    if (!teamIdsParam) {
      socket.close(4000, "teamIds required");
      return;
    }
    const requestedIds = teamIdsParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    // Validate the requester is a member or admin of every requested team
    const objectIds = requestedIds.flatMap((id) => {
      try {
        return [new ObjectId(id)];
      } catch {
        return [];
      }
    });
    const allTeams = await teamsCollection()
      .find({ _id: { $in: objectIds } })
      .toArray();

    const userId = session.user.id;
    const teamIds = allTeams
      .filter((t) => {
        const tid = t._id.toHexString();
        return (
          requestedIds.includes(tid) && (t.members?.includes(userId) || t.admins?.includes(userId))
        );
      })
      .map((t) => t._id.toHexString());

    if (teamIds.length === 0) {
      socket.close(4003, "Forbidden");
      return;
    }

    // Send initial snapshot
    const initial = await clockService.getLiveForTeams(teamIds);
    const snapshot = initial.map(toPublicClockEvent);
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ type: "snapshot", events: snapshot }));
    }

    // Subscribe to future broadcasts
    const unsub = subscribe((teamId, event) => {
      if (!teamIds.includes(teamId)) return;
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: "update", teamId, event }));
      }
    });

    socket.on("close", unsub);
  });
}
