import { FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";
import { requireAuth } from "../middleware/require-auth.js";
import { ticketsCollection } from "../models/index.js";
import {
  timerService,
  toPublicEntry,
  toPublicSession,
  toUtcDateKey,
  subscribeToTimerUpdates,
} from "../services/timer.service.js";
import { auth } from "../lib/auth.js";

// ─── Response shapes ──────────────────────────────────────────────────────────

const entryShape = {
  type: "object",
  properties: {
    id: { type: "string" },
    userId: { type: "string" },
    ticketId: { type: "string" },
    displayTitle: { type: "string", nullable: true },
    date: { type: "string" },
    note: { type: "string", nullable: true },
    sortOrder: { type: "number", nullable: true },
    createdAt: { type: "string" },
    updatedAt: { type: "string", nullable: true },
  },
};

const sessionShape = {
  type: "object",
  properties: {
    id: { type: "string" },
    workItemId: { type: "string" },
    userId: { type: "string" },
    date: { type: "string" },
    startTime: { type: "number" },
    endTime: { type: "number", nullable: true },
    durationSeconds: { type: "number", nullable: true },
    createdAt: { type: "string" },
  },
};

const dayEntryShape = {
  type: "object",
  properties: {
    entry: entryShape,
    sessions: { type: "array", items: sessionShape },
  },
};

const err = (description: string) => ({
  type: "object",
  properties: { error: { type: "string", example: description } },
});

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function timerRoutes(app: FastifyInstance) {
  // GET /v1/timers/day?date=YYYY-MM-DD&tz=America/New_York
  app.get(
    "/timers/day",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Timers"],
        summary: "List WorkItems with timers for a local calendar day",
        querystring: {
          type: "object",
          required: ["date"],
          properties: {
            date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            tz: { type: "string", default: "UTC" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: { entries: { type: "array", items: dayEntryShape } },
          },
        },
      },
    },
    async (req, reply) => {
      const { id: userId } = (req as any).user;
      const { date, tz = "UTC" } = req.query as { date: string; tz?: string };
      const entries = await timerService.getDayEntries(userId, date, tz);

      const ticketIds = [...new Set(entries.map(({ entry }) => entry.ticketId))]
        .filter((id) => /^[0-9a-f]{24}$/i.test(id))
        .map((id) => new ObjectId(id));
      const tickets = ticketIds.length
        ? await ticketsCollection()
            .find({ _id: { $in: ticketIds } }, { projection: { _id: 1, title: 1 } })
            .toArray()
        : [];
      const ticketTitleMap = new Map(tickets.map((t) => [t._id.toHexString(), t.title]));

      return reply.send({
        entries: entries.map(({ entry, sessions }) => ({
          entry: toPublicEntry(entry, ticketTitleMap.get(entry.ticketId) ?? null),
          sessions: sessions.map(toPublicSession),
        })),
      });
    }
  );

  // GET /v1/timers/week?date=YYYY-MM-DD&tz=America/New_York
  // date = Monday of the week in local time
  app.get(
    "/timers/week",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Timers"],
        summary: "Get per-day totals for a 7-day week (Mon–Sun)",
        querystring: {
          type: "object",
          required: ["date"],
          properties: {
            date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            tz: { type: "string", default: "UTC" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              days: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    date: { type: "string" },
                    totalSeconds: { type: "number" },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const { id: userId } = (req as any).user;
      const { date, tz = "UTC" } = req.query as { date: string; tz?: string };
      const days = await timerService.getWeekTotals(userId, date, tz);
      return reply.send({ days });
    }
  );

  // POST /v1/timers/entries — create a WorkItem (and optionally start a timer)
  app.post(
    "/timers/entries",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Timers"],
        summary: "Create a WorkItem for a ticket on a given date",
        body: {
          type: "object",
          required: ["ticketId", "date"],
          additionalProperties: false,
          properties: {
            ticketId: { type: "string" },
            date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            note: { type: "string" },
            startNow: { type: "boolean", default: false },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              entry: entryShape,
              session: { ...sessionShape, nullable: true },
            },
          },
          422: err("Cannot start a timer on a previous day"),
          403: err("Forbidden"),
          404: err("Ticket not found"),
        },
      },
    },
    async (req, reply) => {
      const { id: userId } = (req as any).user;
      const { ticketId, date, note, startNow } = req.body as {
        ticketId: string;
        date: string;
        note?: string;
        startNow?: boolean;
      };

      const entryResult = await timerService.getOrCreateEntry(userId, ticketId, date);
      if (entryResult === "not-found") return reply.status(404).send({ error: "Ticket not found" });
      if (entryResult === "forbidden") return reply.status(403).send({ error: "Forbidden" });

      if (note) {
        // Patch note onto work item (best-effort, non-critical)
        const { workItemsCollection } = await import("../models/index.js");
        const { ObjectId } = await import("mongodb");
        await workItemsCollection().updateOne(
          { _id: new ObjectId(entryResult._id) },
          { $set: { note, updatedAt: new Date() } }
        );
        entryResult.note = note;
      }

      let session = null;
      if (startNow) {
        const startResult = await timerService.startTimerForEntry(
          userId,
          entryResult._id.toHexString(),
          Date.now()
        );

        switch (startResult.type) {
          case "not-found":
          case "forbidden":
            break;
          case "invalid-date":
            return reply.status(422).send({ error: "Cannot start a timer on a previous day" });
          case "success":
            session = toPublicSession(startResult.session);
            break;
          default:
            throw new Error("Unexpected result type");
        }
      }

      const createdTicket = await ticketsCollection().findOne(
        { _id: new ObjectId(entryResult.ticketId) },
        { projection: { _id: 0, title: 1 } }
      );

      return reply
        .status(201)
        .send({ entry: toPublicEntry(entryResult, createdTicket?.title ?? null), session });
    }
  );

  // POST /v1/timers/entries/:id/start — start a timer for a WorkItem
  app.post(
    "/timers/entries/:id/start",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Timers"],
        summary: "Start a timer for a WorkItem",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            now: { type: "number" },
            tz: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              session: sessionShape,
              closedSessionId: { type: "string", nullable: true },
            },
          },
          404: err("WorkItem not found"),
          403: err("Forbidden"),
          422: err("Cannot start a timer on a previous day"),
        },
      },
    },
    async (req, reply) => {
      const { id: userId } = (req as any).user;
      const { id: entryId } = req.params as { id: string };
      const { now = Date.now(), tz } = req.body as { now?: number; tz?: string };

      const result = await timerService.startTimerForEntry(userId, entryId, now, tz);

      switch (result.type) {
        case "not-found":
          return reply.status(404).send({ error: "WorkItem not found" });
        case "forbidden":
          return reply.status(403).send({ error: "Forbidden" });
        case "invalid-date":
          return reply.status(422).send({ error: "Cannot start a timer on a previous day" });
        case "success":
          return reply.send({
            session: toPublicSession(result.session),
            closedSessionId: result.closedSessionId,
          });
        default:
          throw new Error("Unexpected result type");
      }
    }
  );

  // POST /v1/timers/sessions/:id/stop — stop a running timer
  app.post(
    "/timers/sessions/:id/stop",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Timers"],
        summary: "Stop a running timer session",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: { now: { type: "number" } },
        },
        response: {
          200: { type: "object", properties: { session: sessionShape } },
          404: err("Session not found"),
          403: err("Forbidden"),
          409: err("Session already stopped"),
        },
      },
    },
    async (req, reply) => {
      const { id: userId } = (req as any).user;
      const { id: sessionId } = req.params as { id: string };
      const { now = Date.now() } = req.body as { now?: number };

      const result = await timerService.stopTimer(userId, sessionId, now);
      if (result === "not-found") return reply.status(404).send({ error: "Session not found" });
      if (result === "forbidden") return reply.status(403).send({ error: "Forbidden" });
      if (result === "already-stopped")
        return reply.status(409).send({ error: "Session already stopped" });

      return reply.send({ session: toPublicSession(result) });
    }
  );

  // DELETE /v1/timers/entries/:id — delete a WorkItem and all its timers
  app.delete(
    "/timers/entries/:id",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Timers"],
        summary: "Delete a WorkItem and all associated Timers",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            notifyAdmins: { type: "boolean", default: true },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              deletedEntry: { type: "boolean" },
              deletedSessions: { type: "number" },
            },
          },
          404: err("WorkItem not found"),
          403: err("Forbidden"),
        },
      },
    },
    async (req, reply) => {
      const { id: userId } = (req as any).user;
      const { id: entryId } = req.params as { id: string };
      const { notifyAdmins = true } = req.body as { notifyAdmins?: boolean };

      const result = await timerService.deleteEntry(userId, entryId, notifyAdmins);
      if (result === "not-found") return reply.status(404).send({ error: "WorkItem not found" });
      if (result === "forbidden") return reply.status(403).send({ error: "Forbidden" });

      return reply.send(result);
    }
  );

  // POST /v1/timers/copy-previous — copy entries from most recent previous day
  app.post(
    "/timers/copy-previous",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Timers"],
        summary: "Copy WorkItem rows from the most recent previous day to today",
        body: {
          type: "object",
          required: ["toDate"],
          additionalProperties: false,
          properties: {
            toDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          },
        },
        response: {
          200: { type: "object", properties: { created: { type: "number" } } },
        },
      },
    },
    async (req, reply) => {
      const { id: userId } = (req as any).user;
      const { toDate } = req.body as { toDate: string };
      const created = await timerService.copyFromPrevious(userId, toDate);
      return reply.send({ created });
    }
  );

  // GET /v1/timers/tickets/:ticketId/total — total seconds for a ticket
  app.get(
    "/timers/tickets/:ticketId/total",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Timers"],
        summary: "Get total accumulated seconds for a ticket across all closed sessions",
        params: {
          type: "object",
          required: ["ticketId"],
          properties: { ticketId: { type: "string" } },
        },
        response: {
          200: { type: "object", properties: { totalSeconds: { type: "number" } } },
        },
      },
    },
    async (req, reply) => {
      const { ticketId } = req.params as { ticketId: string };
      const totalSeconds = await timerService.getTicketTotal(ticketId);
      return reply.send({ totalSeconds });
    }
  );

  // GET /v1/timers/running — get the current user's running session (if any)
  app.get(
    "/timers/running",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Timers"],
        summary: "Get the current user's running timer, or null",
        response: {
          200: {
            type: "object",
            properties: { session: { ...sessionShape, nullable: true } },
          },
        },
      },
    },
    async (req, reply) => {
      const { id: userId } = (req as any).user;
      const { timersCollection } = await import("../models/index.js");
      const session = await timersCollection().findOne({ userId, endTime: null });
      return reply.send({ session: session ? toPublicSession(session) : null });
    }
  );

  // GET /v1/timers/team-running?teamId=xxx — running timers for all team members
  app.get(
    "/timers/team-running",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Timers"],
        summary: "Get all running timers for members of a team",
        querystring: {
          type: "object",
          required: ["teamId"],
          properties: { teamId: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            properties: {
              timers: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    timerId: { type: "string" },
                    workItemId: { type: "string" },
                    userId: { type: "string" },
                    userName: { type: "string" },
                    userImage: { type: "string", nullable: true },
                    ticketId: { type: "string" },
                    ticketTitle: { type: "string" },
                    startTime: { type: "number" },
                  },
                },
              },
            },
          },
          403: err("Forbidden"),
          404: err("Team not found"),
        },
      },
    },
    async (req, reply) => {
      const { id: userId } = (req as any).user;
      const { teamId } = req.query as { teamId: string };
      const result = await timerService.getTeamRunningTimers(userId, teamId);
      if (result === "not-found") return reply.code(404).send({ error: "Team not found" });
      if (result === "forbidden") return reply.code(403).send({ error: "Forbidden" });
      return reply.send({ timers: result });
    }
  );

  app.get(
    "/timers/today",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Timers"],
        summary: "List WorkItems for today (local time)",
        querystring: {
          type: "object",
          properties: {
            tz: { type: "string", default: "UTC" },
            userId: { type: "string", description: "User ID (admin-only)" },
          },
        },
      },
    },
    async (req, reply) => {
      const { id: requestingUserId } = (req as any).user;
      const { tz = "UTC", userId: targetUserId } = req.query as { tz?: string; userId?: string };

      // If userId is provided, verify admin permission
      const userId = targetUserId || requestingUserId;
      if (targetUserId && targetUserId !== requestingUserId) {
        const { teamsCollection } = await import("../models/index.js");
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

      const today = toUtcDateKey(Date.now());
      const entries = await timerService.getDayEntries(userId, today, tz);

      const ticketIds = [...new Set(entries.map(({ entry }) => entry.ticketId))]
        .filter((id) => /^[0-9a-f]{24}$/i.test(id))
        .map((id) => new ObjectId(id));
      const tickets = ticketIds.length
        ? await ticketsCollection()
            .find({ _id: { $in: ticketIds } }, { projection: { _id: 1, title: 1 } })
            .toArray()
        : [];
      const ticketTitleMap = new Map(tickets.map((t) => [t._id.toHexString(), t.title]));

      return reply.send({
        entries: entries.map(({ entry, sessions }) => ({
          entry: toPublicEntry(entry, ticketTitleMap.get(entry.ticketId) ?? null),
          sessions: sessions.map(toPublicSession),
        })),
      });
    }
  );

  // PATCH /v1/timers/entries/:id — update note, duration, and/or ticket
  app.patch(
    "/timers/entries/:id",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Timers"],
        summary: "Update a WorkItem's note, duration, and/or ticket",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            note: { type: "string", nullable: true },
            durationSeconds: { type: "number", minimum: 0 },
            ticketId: { type: "string" },
          },
        },
        response: {
          200: { type: "object", properties: { entry: entryShape } },
          403: err("Forbidden"),
          404: err("WorkItem not found"),
          422: err("Ticket not found"),
        },
      },
    },
    async (req, reply) => {
      const { id: userId } = (req as any).user;
      const { id: entryId } = req.params as { id: string };
      const { note, durationSeconds, ticketId } = req.body as {
        note?: string | null;
        durationSeconds?: number;
        ticketId?: string;
      };

      const result = await timerService.updateEntry(userId, entryId, {
        note,
        durationSeconds,
        ticketId,
      });
      if (result === "not-found") return reply.status(404).send({ error: "WorkItem not found" });
      if (result === "ticket-not-found")
        return reply.status(422).send({ error: "Ticket not found" });
      if (result === "forbidden") return reply.status(403).send({ error: "Forbidden" });

      const updatedTicket = await ticketsCollection().findOne(
        { _id: new ObjectId(result.ticketId) },
        { projection: { _id: 0, title: 1 } }
      );
      return reply.send({ entry: toPublicEntry(result, updatedTicket?.title ?? null) });
    }
  );

  // GET /v1/timers/ws?token=<optional>
  // WebSocket endpoint for real-time timer updates
  app.get(
    "/timers/ws",
    {
      websocket: true,
      schema: {
        tags: ["Timers"],
        summary: "WebSocket stream for real-time timer updates",
        querystring: {
          type: "object",
          properties: {
            token: { type: "string", description: "Optional Bearer token for mobile auth" },
          },
        },
      },
    },
    async (socket, req) => {
      const { token: queryToken } = req.query as { token?: string };

      // Auth: accept Bearer token from query param (Capacitor) or cookie
      const headers: Record<string, string> = { ...(req.headers as any) };
      if (queryToken) headers["authorization"] = `Bearer ${queryToken}`;
      const session = await auth.api.getSession({ headers });

      if (!session?.user) {
        console.log("[timers/ws] Unauthorized connection attempt");
        socket.close(4001, "Unauthorized");
        return;
      }

      const userId = session.user.id;
      console.log(`[timers/ws] User ${userId} connected`);

      // Subscribe to timer updates for this user
      const unsubscribe = subscribeToTimerUpdates((updateUserId, event) => {
        if (updateUserId === userId) {
          console.log(`[timers/ws] Sending ${event} message to user ${userId}`);
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify({ type: event }));
          }
        }
      });

      // Send initial snapshot
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: "connected" }));
        console.log(`[timers/ws] Sent connected message to user ${userId}`);
      }

      // Clean up on disconnect
      socket.on("close", () => {
        console.log(`[timers/ws] User ${userId} disconnected`);
        unsubscribe();
      });
    }
  );
}
