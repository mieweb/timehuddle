import { FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";
import { auth } from "../lib/auth.js";
import { requireAuth } from "../middleware/require-auth.js";
import {
  clockService,
  toPublicClockEvent,
  subscribe,
  computeWorkSeconds,
} from "../services/clock.service.js";
import { findBreaksForEvents } from "../models/clock.model.js";
import { teamsCollection, usersCollection, profilesCollection } from "../models/index.js";
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
        querystring: {
          type: "object",
          properties: {
            userId: { type: "string", description: "User ID (admin-only)" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: { event: { ...clockEventShape, nullable: true } },
          },
          403: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (req, reply) => {
      const { id: requestingUserId } = (req as any).user;
      const { userId: targetUserId } = req.query as { userId?: string };

      // If userId is provided, verify admin permission
      const userId = targetUserId || requestingUserId;
      if (targetUserId && targetUserId !== requestingUserId) {
        const sharedAdminTeams = await teamsCollection()
          .find({
            admins: requestingUserId,
            $or: [{ members: targetUserId }, { admins: targetUserId }],
          })
          .toArray();

        if (sharedAdminTeams.length === 0) {
          return reply.status(403).send({ error: "Forbidden" });
        }
      }

      // Get the active clock event for the resolved userId
      const event = await clockService.getActiveForUser(userId);
      const breaks = event ? await findBreaksForEvents([event._id.toHexString()]) : [];
      const publicEvent = event ? toPublicClockEvent(event, breaks) : null;
      return reply.send({ event: publicEvent });
    }
  );

  // GET /v1/clock/team-status?teamId=xxx — active clock events for all team members + today's hours
  app.get(
    "/clock/team-status",
    {
      onRequest: [requireAuth],
      schema: {
        tags: ["Clock"],
        summary: "Get active clock events and today's hours for all team members",
        querystring: {
          type: "object",
          required: ["teamId"],
          properties: { teamId: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            properties: {
              members: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    userId: { type: "string" },
                    name: { type: "string" },
                    image: { type: "string", nullable: true },
                    isClockedIn: { type: "boolean" },
                    isOnBreak: { type: "boolean" },
                    activeClockStart: { type: "number", nullable: true },
                    todaySeconds: { type: "number" },
                  },
                },
              },
            },
          },
          403: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (req, reply) => {
      const { id: requestingUserId } = (req as any).user;
      const { teamId } = req.query as { teamId: string };

      if (!/^[0-9a-f]{24}$/i.test(teamId)) {
        return reply.code(404).send({ error: "Team not found" });
      }

      const team = await teamsCollection().findOne({ _id: new ObjectId(teamId) });
      if (!team) return reply.code(404).send({ error: "Team not found" });

      const allMemberIds = Array.from(new Set([...team.members, ...team.admins]));
      if (!allMemberIds.includes(requestingUserId)) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      // Get today's start (UTC midnight)
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      const todayStartMs = todayStart.getTime();
      const now = Date.now();

      // Get active and today's clock events for all members
      const { clockEventsCollection } = await import("../models/index.js");
      const clockEvents = await clockEventsCollection()
        .find({
          userId: { $in: allMemberIds },
          teamId,
          startTime: { $gte: todayStartMs },
        })
        .toArray();

      // Load all breaks for today's events in a single query
      const eventIds = clockEvents.map((e) => e._id.toHexString());
      const allBreaks = eventIds.length > 0 ? await findBreaksForEvents(eventIds) : [];
      const breaksByEventId = new Map<string, typeof allBreaks>();
      for (const b of allBreaks) {
        const arr = breaksByEventId.get(b.clockEventId) ?? [];
        arr.push(b);
        breaksByEventId.set(b.clockEventId, arr);
      }

      // Gather user info
      const validIds = allMemberIds.filter((id) => /^[0-9a-f]{24}$/i.test(id));
      const [users, profiles] = await Promise.all([
        usersCollection()
          .find({ _id: { $in: validIds.map((id) => new ObjectId(id)) } })
          .project<{ _id: ObjectId; name: string; image: string | null }>({
            _id: 1,
            name: 1,
            image: 1,
          })
          .toArray(),
        profilesCollection()
          .find({ userId: { $in: allMemberIds }, app: "timeharbor" })
          .project<{ userId: string; displayName: string; avatar: string | null }>({
            userId: 1,
            displayName: 1,
            avatar: 1,
          })
          .toArray(),
      ]);

      const userMap = new Map(users.map((u) => [u._id.toHexString(), u]));
      const profileMap = new Map(profiles.map((p) => [p.userId, p]));

      // Group clock events by userId
      const eventsByUser = new Map<string, typeof clockEvents>();
      for (const ev of clockEvents) {
        if (!eventsByUser.has(ev.userId)) eventsByUser.set(ev.userId, []);
        eventsByUser.get(ev.userId)!.push(ev);
      }

      const members = allMemberIds.map((userId) => {
        const profile = profileMap.get(userId);
        const userDoc = userMap.get(userId);
        const name = profile?.displayName || userDoc?.name || "Unknown";
        const image = profile?.avatar ?? userDoc?.image ?? null;

        const userEvents = eventsByUser.get(userId) ?? [];
        const activeEvent = userEvents.find((e) => e.endTime === null) ?? null;
        const isClockedIn = activeEvent !== null;
        const activeBreaks = activeEvent
          ? (breaksByEventId.get(activeEvent._id.toHexString()) ?? [])
          : [];
        const isOnBreak = activeBreaks.some((b) => b.endTime === null);

        // Sum today's break-adjusted work seconds (matches timesheet logic)
        let todaySeconds = 0;
        for (const ev of userEvents) {
          const breaks = breaksByEventId.get(ev._id.toHexString()) ?? [];
          todaySeconds += computeWorkSeconds(ev, breaks, now);
        }

        return {
          userId,
          name,
          image,
          isClockedIn,
          isOnBreak,
          activeClockStart: activeEvent?.startTime ?? null,
          todaySeconds,
        };
      });

      return reply.send({ members });
    }
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

  // POST /v1/clock/events/:eventId/agree-clockout — user consents to auto-clockout at 8h
  app.post(
    "/clock/events/:eventId/agree-clockout",
    { onRequest: [requireAuth], schema: { tags: ["Clock"] } },
    clockController.agreeClockout
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
