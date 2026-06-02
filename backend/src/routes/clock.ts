import { FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";
import { auth } from "../lib/auth.js";
import { requireAuth } from "../middleware/require-auth.js";
import { clockService, toPublicClockEvent, subscribe } from "../services/clock.service.js";
import { findBreaksForEvents } from "../models/clock.model.js";
import { teamsCollection } from "../models/index.js";
import { clockController } from "../controllers/clock.controller.js";

// ─── Public shape schema ──────────────────────────────────────────────────────

const clockEventShape = {
  type: "object",
  properties: {
    id: { type: "string" },
    userId: { type: "string" },
    teamId: { type: "string" },
    startTime: { type: "number" },
    accumulatedTime: { type: "number" },
    breaks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          startTime: { type: "number" },
          endTime: { type: "number", nullable: true },
          type: { type: "string", enum: ["rest", "meal"] },
          classificationSource: { type: "string", enum: ["auto", "manual"] },
          notes: { type: "string" },
        },
      },
    },
    workSeconds: { type: "number" },
    deductedBreakSeconds: { type: "number" },
    totalBreakSeconds: { type: "number" },
    isPaused: { type: "boolean" },
    endTime: { type: "number", nullable: true },
    shiftReminderResponse: { type: "string", nullable: true },
    shiftAutoClockoutWorkSecs: { type: "number", nullable: true },
    shiftNextReminderWorkSecs: { type: "number", nullable: true },
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
    clockController.start
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
    clockController.stop
  );

  // POST /v1/clock/pause
  app.post(
    "/clock/pause",
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
    clockController.pause
  );

  // POST /v1/clock/resume
  app.post(
    "/clock/resume",
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
    clockController.resume
  );

  // GET /v1/clock/status?teamId=...
  app.get(
    "/clock/status",
    {
      onRequest: [requireAuth],
      schema: {
        tags: ["Clock"],
        querystring: {
          type: "object",
          required: ["teamId"],
          properties: {
            teamId: { type: "string" },
          },
        },
      },
    },
    clockController.getStatus
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
            breaks: {
              type: "array",
              items: {
                type: "object",
                required: ["startTime"],
                properties: {
                  startTime: { type: "number" },
                  endTime: { type: "number", nullable: true },
                  type: { type: "string", enum: ["rest", "meal"] },
                  classificationSource: { type: "string", enum: ["auto", "manual"] },
                  notes: { type: "string" },
                },
              },
            },
          },
        },
        response: { 200: { type: "object", properties: { event: clockEventShape } } },
      },
    },
    clockController.updateTimes
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
    clockController.deleteEvent
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
    clockController.createManual
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
    clockController.getTimesheet
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
    clockController.getActive
  );

  // GET /v1/clock/events — all events for current user
  app.get(
    "/clock/events",
    {
      onRequest: [requireAuth],
      schema: { tags: ["Clock"] },
    },
    clockController.getEvents
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
    const initialIds = initial.map((e) => e._id.toHexString());
    const initialBreaks = await findBreaksForEvents(initialIds);
    const initialBreaksByEventId = new Map<string, typeof initialBreaks>();
    for (const b of initialBreaks) {
      const arr = initialBreaksByEventId.get(b.clockEventId) ?? [];
      arr.push(b);
      initialBreaksByEventId.set(b.clockEventId, arr);
    }
    const snapshot = initial.map((e) =>
      toPublicClockEvent(e, initialBreaksByEventId.get(e._id.toHexString()) ?? [])
    );
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
